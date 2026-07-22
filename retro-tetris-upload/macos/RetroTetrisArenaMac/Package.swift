// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "RetroTetrisArenaMac",
  platforms: [
    .macOS(.v13)
  ],
  products: [
    .executable(name: "RetroTetrisArena", targets: ["RetroTetrisArena"])
  ],
  targets: [
    .executableTarget(
      name: "RetroTetrisArena",
      path: "Sources"
    )
  ]
)
