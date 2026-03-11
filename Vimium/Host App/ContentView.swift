import SafariServices
import SwiftUI

struct ContentView: View {
    @State private var extensionEnabled: Bool?

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "keyboard")
                .font(.system(size: 64))
                .foregroundStyle(.secondary)

            Text("Vimium for Safari")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Navigate the web with your keyboard")
                .font(.title3)
                .foregroundStyle(.secondary)

            Divider()
                .frame(width: 200)

            if let enabled = extensionEnabled {
                if enabled {
                    Label("Extension is enabled", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                        .font(.headline)
                } else {
                    enableInstructions
                }
            } else {
                enableInstructions
            }
        }
        .padding(40)
        .frame(minWidth: 480, minHeight: 360)
        .onAppear(perform: checkExtensionState)
    }

    private var enableInstructions: some View {
        VStack(spacing: 16) {
            Text("Enable Vimium in Safari to get started:")
                .font(.headline)

            Text("1. Open Safari → Settings → Extensions\n2. Check the box next to Vimium\n3. Grant permission for all websites")
                .multilineTextAlignment(.leading)
                .foregroundStyle(.secondary)

            Button("Open Safari Extension Preferences…") {
                SFSafariApplication.showPreferencesForExtension(
                    withIdentifier: "com.anthropic.Vimium.Extension"
                )
            }
            .controlSize(.large)
        }
    }

    private func checkExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(
            withIdentifier: "com.anthropic.Vimium.Extension"
        ) { state, error in
            DispatchQueue.main.async {
                extensionEnabled = state?.isEnabled ?? false
            }
        }
    }
}
