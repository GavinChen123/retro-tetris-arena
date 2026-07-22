# Retro Tetris Arena Mac

This is a small native macOS wrapper for the browser game. It opens the hosted game inside a `WKWebView`, so it feels like a Mac app while still using the same multiplayer server and web code.

## Open In Xcode

1. Open Xcode.
2. Choose `File > Open`.
3. Select this folder: `macos/RetroTetrisArenaMac`.
4. Choose the `RetroTetrisArena` scheme.
5. Press Run.

## Change The Game URL

The default URL is set in `Sources/RetroTetrisArenaApp.swift`.

For full realtime multiplayer, set `defaultGameURL` to your Render URL, for example:

```swift
private let defaultGameURL = "https://your-render-app.onrender.com"
```

You can also override it while running from Xcode by setting the environment variable `RETRO_TETRIS_URL` in the scheme.
