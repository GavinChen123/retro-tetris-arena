# Retro Tetris Arena

An old 8-bit styled Tetris game with:

- Singleplayer Tetris
- Multiplayer menu with vs Computer playable in the browser
- Realtime vs Human matchmaking, friends, challenges, and accounts when the Node server is running
- GitHub Pages deployment for a playable static browser version

## Play Locally

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Install On Mac

The app is now installable as a Mac web app.

- Safari: open the hosted game, then choose `File > Add to Dock`.
- Chrome: open the hosted game, click the install icon in the address bar or choose `More Tools > Create Shortcut`, then enable `Open as window`.

The installed app opens in its own window and caches the game shell for faster loading. Realtime multiplayer still needs the Node server to be online.

## Build A Mac App With Xcode

There is also a native macOS wrapper in `macos/RetroTetrisArenaMac`.

Open that folder in Xcode, choose the `RetroTetrisArena` scheme, and press Run. The app uses SwiftUI plus `WKWebView` to load `https://retro-tetris-arena.onrender.com/` in a native Mac window so realtime multiplayer works.

## Deploy Full Multiplayer To Koyeb

Koyeb can run the Node server needed for accounts, quick play, friend challenges, and Socket.IO multiplayer.

1. Push this project to a GitHub repository.
2. In Koyeb, create a Web Service.
3. Choose GitHub as the deployment source and select the repository.
4. Use either the Buildpack builder or the included Dockerfile.
5. Set the run/start command to `npm start` if Koyeb asks.
6. Expose the HTTP service on the port from the `PORT` environment variable. The app already reads `process.env.PORT`.
7. Set the health check path to `/healthz`.

For the free tier, keep the service to one instance. The current matchmaking state is in memory, so multiple instances would need a Socket.IO adapter such as Redis.

Accounts and friends are stored in `data/db.json` by default. If your host provides persistent storage, set `DATA_DIR` to that mounted directory. Without persistent storage, accounts may reset on redeploy.

## Deploy Full Multiplayer To Render

Render's free web service is the simplest fallback for the Node multiplayer server. It supports Express and Socket.IO, but the free plan sleeps after idle time, so the first player may see a cold start delay.

1. Push this project to a GitHub repository.
2. In Render, create a new Web Service.
3. Connect the GitHub repository.
4. Use these settings:
   - Environment: `Node`
   - Build command: `npm ci`
   - Start command: `npm start`
   - Health check path: `/healthz`
   - Plan: `Free`
5. Deploy.

The included `render.yaml` can also be used as a Render Blueprint.

## Publish To GitHub Pages

After pushing this folder to a GitHub repo, enable Pages with GitHub Actions as the source. The included workflow publishes the `public/` folder.

GitHub Pages can host the browser game, but it cannot run the Node/Socket.IO server. On Pages, singleplayer and vs Computer work immediately. Realtime human matches need this Node app deployed to a server such as Render, Railway, Fly.io, or a VPS.

## Controls

- Left/Right: move
- Down: soft drop 2x faster
- Double-tap Down or Right Shift: hard drop
- Up or Space: rotate
