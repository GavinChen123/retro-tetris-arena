import SwiftUI
import WebKit

private let defaultGameURL = "https://gavinchen123.github.io/retro-tetris-arena/"

@main
struct RetroTetrisArenaApp: App {
  var body: some Scene {
    WindowGroup {
      ContentView(gameURL: configuredGameURL)
        .frame(minWidth: 900, minHeight: 720)
    }
    .windowStyle(.titleBar)
    .commands {
      CommandGroup(replacing: .newItem) {}
    }
  }
}

private var configuredGameURL: URL {
  let value = ProcessInfo.processInfo.environment["RETRO_TETRIS_URL"] ?? defaultGameURL
  return URL(string: value) ?? URL(string: defaultGameURL)!
}

struct ContentView: View {
  let gameURL: URL

  var body: some View {
    GameWebView(url: gameURL)
      .ignoresSafeArea()
      .background(Color(red: 0.067, green: 0.063, blue: 0.094))
  }
}

struct GameWebView: NSViewRepresentable {
  let url: URL

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  func makeNSView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.websiteDataStore = .default()

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = context.coordinator
    webView.allowsBackForwardNavigationGestures = false
    webView.setValue(false, forKey: "drawsBackground")
    webView.load(URLRequest(url: url))
    return webView
  }

  func updateNSView(_ webView: WKWebView, context: Context) {
    if webView.url == nil {
      webView.load(URLRequest(url: url))
    }
  }

  final class Coordinator: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
      showError(error, in: webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
      showError(error, in: webView)
    }

    private func showError(_ error: Error, in webView: WKWebView) {
      let message = error.localizedDescription
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "'", with: "\\'")
      let html = """
      <!doctype html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #111018;
              color: #f8f8d8;
              font: 700 18px "Courier New", monospace;
            }
            main {
              width: min(680px, calc(100vw - 32px));
              border: 4px solid #f8f8d8;
              padding: 24px;
              background: #222034;
              box-shadow: 8px 8px 0 #06050a;
            }
            h1 { margin: 0 0 12px; color: #d9a441; }
            p { line-height: 1.5; }
          </style>
        </head>
        <body>
          <main>
            <h1>Could not load Retro Tetris Arena</h1>
            <p>\(message)</p>
            <p>Check your internet connection or set RETRO_TETRIS_URL to your live Render URL in the Xcode scheme.</p>
          </main>
        </body>
      </html>
      """
      webView.loadHTMLString(html, baseURL: nil)
    }
  }
}
