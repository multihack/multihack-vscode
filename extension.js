var vscode = require('vscode')
var mkdirp = require('mkdirp')
var fs = require('fs')
var trash = require('trash')

var DEFAULT_HOSTNAME = 'https://quiet-shelf-57463.herokuapp.com'

var RemoteManager = require('./lib/remote')

var config = vscode.workspace.getConfiguration('multihack-vscode')
var context = null
var remote = null
var projectBasePath = null
var relativePath = null
var isSyncing = false
var currentEditor = null
var editorMutexLock = false
var watcher = null

var workspaceEditQueue = []
var dumpingWorkspaceQueue = false

function activate (newContext) {
  console.log('Congratulations, your extension "multihack-vscode" is now active!')

  context = newContext

  vscode.commands.registerCommand('extension.multihackJoinOrLeaveRoom', handleStart)
  vscode.commands.registerCommand('extension.multihackFetchCode', requestProject)
}
exports.activate = activate

function deactivate () {
  handleStop()
}
exports.deactivate = deactivate

function handleStart () {
  if (isSyncing) handleStop() // clean up before joining a new room

  if (!vscode.workspace.rootPath) return vscode.window.showErrorMessage('Multihack: Open a folder before joining a room!')
  projectBasePath = vscode.workspace.rootPath

  setupEventListeners()

  getRoomAndNickname(function (roomID, nickname) {
    remote = new RemoteManager(config.get('multihack.hostname') || DEFAULT_HOSTNAME, roomID, nickname)

    remote.on('changeFile', handleRemoteChangeFile)
    remote.on('deleteFile', handleRemoteDeleteFile)
    remote.on('requestProject', handleRequestProject)
    remote.on('provideFile', handleProvideFile)

    remote.once('gotPeer', function () {
      console.log('gotPeer')
      remote.requestProject()
    })
    remote.on('lostPeer', function (peer) {
      vscode.window.showInformationMessage('Multihack: Lost connection to '+peer.metadata.nickname);
    })

    isSyncing = true
    console.log('MH started')
  })
}

function setupEventListeners () {
  vscode.workspace.onDidChangeConfiguration(function () { 
    if (projectBasePath !== vscode.workspace.rootPath) handleStop() // stop on new project opened
  })

  vscode.window.onDidChangeActiveTextEditor(handleEditorChange)
  handleEditorChange()

  vscode.workspace.onDidChangeTextDocument(handleLocalChangeFile)

  watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false)
  watcher.onDidDelete(handleLocalDeleteFile)
  watcher.onDidCreate(handleLocalCreateFile)
}

function handleRequestProject (requester) {
  // vscode is an electron app, so we don't have to worry about forwarding limits
  vscode.workspace.textDocuments.forEach(function (doc) {
    fs.readFile(doc.fileName, function (err, content) {
      if (err) return
      var filePath = toWebPath(vscode.workspace.asRelativePath(currentEditor.document.fileName))
      remote.provideFile(filePath, content.toString(), requester)
    })
  })
}

function handleProvideFile (data) {
  var filePath = projectBasePath+data.filePath
  var range = new vscode.Range(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
  var textEdit = new vscode.TextEdit(range, data.content)
  applyWorkspaceEdits(filePath, [textEdit], noop)
}

function handleEditorChange () {
  currentEditor = vscode.window.activeTextEditor
  if (currentEditor) relativePath = toWebPath(vscode.workspace.asRelativePath(currentEditor.document.fileName))
}

function handleLocalCreateFile (uri) {
  var relativePath = toWebPath(vscode.workspace.asRelativePath(uri.path))
  fs.readFile(uri.path, function (err, content) {
    if (err) return
    remote.changeFile(relativePath, {
      from: {line: 0, ch: 0},
      to: { line: 0, ch: 0},
      text: content.toString(),
      origin: 'paste'
    })
  })
}

function handleLocalDeleteFile (uri) {
  remote.deleteFile(toWebPath(vscode.workspace.asRelativePath(uri.path)))
}

function handleLocalChangeFile (e) {
  if (editorMutexLock || !isSyncing) return
  for (var i=0; i<e.contentChanges.length; i++) { 
    var change = toCodeMirrorChange(e.contentChanges[i])
    console.log(relativePath, change)
    remote.changeFile(relativePath, change)
  }
}

function handleRemoteChangeFile (data) {
  console.log(data)
  if (data.change.type === 'rename') {
    return //todo
  } else if (data.change.type === 'selection') {
    return // todo
  } else {
    applyChange(data.filePath, data.change)
  }
}

function handleRemoteDeleteFile (data) {
  var absPath = projectBasePath+data.filePath
  trash([absPath])
}

function applyChange (filePath, change) {
  var workspaceEdit = new vscode.WorkspaceEdit()
  var textEdit = toVscodeEdit(change, null) 
  applyWorkspaceEdits(projectBasePath+filePath, [textEdit], function (err) {
    workspaceEditQueue.push({
      filePath: filePath,
      edit: textEdit
    })
    if (!dumpingWorkspaceQueue) {
      dumpingWorkspaceQueue = true
      setTimeout(dumpWorkspaceQueue, 10)
    }
  })
}

// same as above, but for workspace
function dumpWorkspaceQueue () {

  // group by filePath (alphabetical sort)
  workspaceEditQueue.sort(function (a, b) {
    return a.filePath.localeCompare(b.filePath)
  })

  var currentGroup = [] // current group of edits
  var currentPath = null // current uri of file being edited
  workspaceEditQueue.forEach(function (x) {
    if (x.filePath !== currentPath) { // new group
      if (currentPath !== null) { 
        // apply the group
        applyWorkspaceEdits(projectBasePath+currentPath, currentGroup, function (err) {
          vscode.window.showErrorMessage('Multihack: Failed to apply changes!')
        })
      }  
      currentGroup = [x.edit]
      currentPath = x.filePath
    } else { // same group
      currentGroup.push(x.edit)
    }
  })
}

function applyWorkspaceEdits (filePath, edits, errorCallback) {
  var workspaceEdit = new vscode.WorkspaceEdit()
  vscode.workspace.openTextDocument(filePath).then(function (doc) {
    workspaceEdit.set(doc.uri, edits)
    editorMutexLock = true
    vscode.workspace.applyEdit(workspaceEdit).then(function () {
      editorMutexLock = false
      vscode.workspace.saveAll()
    }, function (err) {
      editorMutexLock = false
      errorCallback(err)
    })
  }, function (err) {
    if (err.indexOf('File not found') !== -1) {
      var parentPath = filePath.split('/').slice(0, -1).join('/')
      mkdirp(parentPath, function (err) {
        if (err) console.error(err)
        fs.writeFile(filePath, '', function () {
          applyWorkspaceEdits(filePath, edits, errorCallback)
        })
      })
    }
  })
}

// convert a vscode change event to a CodeMirror one
function toCodeMirrorChange (change) {
  return {
    from: {
      ch: change.range.start.character,
      line: change.range.start.line
    },
    to: {
      ch: change.range.end.character,
      line: change.range.end.line
    },
    text: change.text,
    removed: '', // todo?
    origin: '' // todo?
  }
}

// build a vscode TextEdit from a Codemirror Change
// if editBuilder is defined, the edit will be applied to that builder
// if not, it returns the TextEdit
function toVscodeEdit(change, editBuilder) {
  var start = new vscode.Position(change.from.line, change.from.ch)
  var end = new vscode.Position(change.to.line, change.to.ch)
  var range = new vscode.Range(start, end)
  if (editBuilder) {
    editBuilder.replace(range, change.text.join('\n'))
  } else {
    return new vscode.TextEdit(range, change.text.join('\n'))
  }
}

function toWebPath (path) {
  return path[0] === '/' ? path : '/'+path
}

function fromWebPath (path) {
  return path[0] === '/' ? path.slice(1) : path
}

function getDocumentFromEditor (vsEditor) {
    return typeof vsEditor._documentData !== 'undefined' ? vsEditor._documentData : vsEditor._document
}

function handleStop () {
  if (!isSyncing) return
  remote.destroy()
  remote = null

  isSyncing = false
  watcher.dispose()

  console.log('MH stopped')
}

function requestProject () {
  if (!isSyncing) return
  remote.requestProject()
}

function getRoomAndNickname (cb) {
  var defaultRoom = config.get('multihack.defaultRoom') || ''

  if (!defaultRoom) {
    defaultRoom = Math.random().toString(36).substr(2, 20)
  }

  vscode.window.showInputBox({
    prompt: 'Enter the ID for the room you want to join:',
    placeHolder: 'RoomID',
    value: defaultRoom,
    ignoreFocusOut: true
  }).then(function (roomID) {
    if (!roomID) return
    vscode.window.showInputBox({
      prompt: 'Enter a nickname so your team knows who you are:',
      placeHolder: 'Nickname',
      ignoreFocusOut: true
    }).then(function (nickname) {
      nickname = nickname || 'Guest'
      cb(roomID, nickname)
    })
  })
}

function noop () {}