# multihack-vscode 

**Coming soon**

Synchronizes code and project structure between multiple users in realtime.

Also check out [the web version](https://github.com/RationalCoding/multihack-web) and [the Brackets extension](https://github.com/RationalCoding/multihack-brackets).

## Usage 
1. Open the folder containing your project.
2. Run the "Join or Leave Room" command.
3. Enter the same room ID as your team, and an optional nickname. 
4. Your code is now being synced!  

## Fetch Code

If someone joins the room with conflicting code, it will not be watched and therefore not synced.  

To get unwatched code or force a sync, run the "Fetch Code" command on the side without the correct code.

## How It Works

Multihack is a cross-editor pair programming tool that currently supports a web editor, Brackets and now VSCode.

It uses a custom P2P protocol to ensure blazing fast speeds!

## Voice Chat

Voice chat is not currently supported in the VSCode version, but it will be coming soon.

## Running Your Own Instance

This extension points to the author's server by default. No code is sent through the server as long as both peers support WebRTC (which most do). 

If you want your own instance, see [multihack-server](https://github.com/RationalCoding/multihack-server).

You can target a different host through the **mulithack.hostname** configuration option.
