# Retro Tetris Arena Mac

This is a small native macOS wrapper for the browser game. It opens the hosted game inside a `WKWebView`, so it feels like a Mac app while still using the same multiplayer server and web code.

## Open In Xcode

1. Open Xcode.
2. Choose `File > Open`.
3. Select this folder: `macos/RetroTetrisArenaMac`.
4. Choose the `RetroTetrisArena` scheme.
5. Press Run.

## Game URL

The default URL is set in `Sources/RetroTetrisArenaApp.swift`:

```swift
private let defaultGameURL = "https://retro-tetris-arena.onrender.com/"
```

That Render app runs the Node server needed for full realtime multiplayer. You can still override it while running from Xcode by setting the environment variable `RETRO_TETRIS_URL` in the scheme.
