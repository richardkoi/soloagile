# A page server, if you want one

soloagile needs no server: a project's page opens as a file, and refreshes itself.
Run this only to read your pages from another device, such as a phone on the same network.

1. Copy this folder somewhere of your own. The plugin's own folder is replaced at every update.
2. Start it, naming the folder your projects sit in:
   ```
   PROJECTS=/path/to/your/projects docker compose up -d
   ```
3. Tell soloagile, in `~/.soloagile/settings.json`. Use this machine's address on your network:
   ```json
   {
     "pageUrl": "http://192.168.0.10:8080/{project}/",
     "projectsFolder": "/path/to/your/projects"
   }
   ```
4. Rebuild a page, for example with `soloagile build` in a project. The home page is then at
   `http://192.168.0.10:8080/`, and each project's page at `/<its folder name>/`.

It serves only each project's `pm/index.html` and the home page. Anyone on your network can
open them, so don't run it on a network you don't trust.
