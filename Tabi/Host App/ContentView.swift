import SafariServices
import SwiftUI

struct ContentView: View {
    var body: some View {
        SetupTab()
            .frame(minWidth: 520, minHeight: 400)
    }
}

struct SetupTab: View {
    @State private var extensionEnabled: Bool?
    @State private var showPrefsFailedAlert = false
    @StateObject private var store = StoreManager.shared

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "keyboard")
                .font(.system(size: 64))
                .foregroundStyle(.secondary)

            Text("tabi")
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

                    Text("Click the tabi icon in Safari's toolbar to access settings.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else {
                    enableInstructions
                }
            } else {
                enableInstructions
            }

            Divider()
                .frame(width: 200)

            premiumSection
        }
        .padding(40)
        .onAppear(perform: checkExtensionState)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            checkExtensionState()
        }
        .alert("Could not open Safari Extensions", isPresented: $showPrefsFailedAlert) {
            Button("OK") {}
        } message: {
            Text("Open Safari, then go to Safari → Settings → Extensions to enable tabi.")
        }
    }

    private var premiumSection: some View {
        VStack(spacing: 12) {
            if store.isPremium {
                Label("Premium Active", systemImage: "star.fill")
                    .foregroundStyle(.orange)
                    .font(.headline)
            } else {
                Text("Upgrade to Premium")
                    .font(.headline)

                Text("Unlock fuzzy search, yank mode, quick marks, extra layouts, and more.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button(action: {
                    Task { await store.purchase() }
                }) {
                    Group {
                        if store.purchaseState == .purchasing {
                            ProgressView()
                                .controlSize(.small)
                                .padding(.horizontal, 8)
                        } else if let product = store.product {
                            Text("Buy Premium — \(product.displayPrice)")
                        } else {
                            Text("Buy Premium")
                        }
                    }
                    .frame(minWidth: 180)
                }
                .controlSize(.large)
                .disabled(store.product == nil || store.purchaseState == .purchasing)

                Button("Restore Purchases") {
                    Task { await store.restore() }
                }
                .buttonStyle(.link)
                .font(.subheadline)

                if case .failed(let message) = store.purchaseState {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }
        }
    }

    private var enableInstructions: some View {
        VStack(spacing: 16) {
            Text("Enable tabi in Safari to get started:")
                .font(.headline)

            Text("1. Open Safari → Settings → Extensions\n2. Check the box next to tabi\n3. Grant permission for all websites")
                .multilineTextAlignment(.leading)
                .foregroundStyle(.secondary)

            Button("Open Safari Extension Preferences…") {
                openExtensionPreferences()
            }
            .controlSize(.large)
        }
    }

    private func openExtensionPreferences() {
        SFSafariApplication.showPreferencesForExtension(
            withIdentifier: "com.brokenalarms.tabi.Extension"
        ) { error in
            if error != nil {
                DispatchQueue.main.async {
                    showPrefsFailedAlert = true
                }
            }
        }
    }

    private func checkExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(
            withIdentifier: "com.brokenalarms.tabi.Extension"
        ) { state, error in
            DispatchQueue.main.async {
                extensionEnabled = state?.isEnabled ?? false
            }
        }
    }
}
