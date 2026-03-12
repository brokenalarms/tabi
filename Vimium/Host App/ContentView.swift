import SafariServices
import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            SetupTab()
                .tabItem {
                    Label("Setup", systemImage: "safari")
                }
            SettingsTab()
                .tabItem {
                    Label("Settings", systemImage: "gearshape")
                }
        }
        .frame(minWidth: 520, minHeight: 400)
    }
}

struct SetupTab: View {
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

private let extensionIdentifier = "com.anthropic.Vimium.Extension"

struct SettingsTab: View {
    @State private var keyBindingMode: String = "location"
    @State private var theme: String = "yellow"
    @State private var excludedDomains: [String] = []
    @State private var newDomain: String = ""

    private let settings = SettingsManager.shared

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                keyBindingSection
                Divider()
                themeSection
                Divider()
                excludedDomainsSection
                Divider()
                safariTip
            }
            .padding(24)
        }
        .onAppear {
            keyBindingMode = settings.keyBindingMode
            theme = settings.theme
            excludedDomains = settings.excludedDomains
        }
    }

    // MARK: - Key Binding Mode

    private var keyBindingSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Key Binding Mode")
                .font(.headline)

            Picker("Key Binding Mode", selection: $keyBindingMode) {
                Text("By Position").tag("location")
                Text("By Character").tag("character")
            }
            .pickerStyle(.segmented)
            .onChange(of: keyBindingMode) { newValue in
                settings.keyBindingMode = newValue
                notifyExtension()
            }

            Text("Position matches physical key location (same across layouts). Character matches what you type (for Dvorak, Colemak, etc.).")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Theme

    private var themeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Theme")
                .font(.headline)

            Picker("Theme", selection: $theme) {
                Text("Yellow").tag("yellow")
                Text("Dark").tag("dark")
                Text("Light").tag("light")
                Text("Auto").tag("auto")
            }
            .pickerStyle(.segmented)
            .onChange(of: theme) { newValue in
                settings.theme = newValue
                notifyExtension()
            }
        }
    }

    // MARK: - Excluded Domains

    private var excludedDomainsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Excluded Domains")
                .font(.headline)

            Text("Vimium will be disabled on these domains.")
                .foregroundStyle(.secondary)
                .font(.subheadline)

            List {
                ForEach(excludedDomains, id: \.self) { domain in
                    HStack {
                        Text(domain)
                            .font(.body.monospaced())
                        Spacer()
                        Button {
                            removeDomain(domain)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .listStyle(.bordered)
            .frame(minHeight: 150)

            HStack {
                TextField("example.com", text: $newDomain)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit(addDomain)

                Button("Add", action: addDomain)
                    .disabled(newDomain.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
    }

    // MARK: - Safari Tip

    private var safariTip: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "info.circle")
                .foregroundStyle(.secondary)
            Text("Safari may also prompt you to allow Vimium on each site individually. You can grant access for all websites in Safari → Settings → Extensions → Vimium.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Actions

    private func addDomain() {
        let domain = newDomain
            .trimmingCharacters(in: .whitespaces)
            .lowercased()
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        guard !domain.isEmpty, !excludedDomains.contains(domain) else { return }

        excludedDomains.append(domain)
        excludedDomains.sort()
        settings.excludedDomains = excludedDomains
        newDomain = ""
        notifyExtension()
    }

    private func removeDomain(_ domain: String) {
        excludedDomains.removeAll { $0 == domain }
        settings.excludedDomains = excludedDomains
        notifyExtension()
    }

    private func notifyExtension() {
        SFSafariApplication.dispatchMessage(
            withName: "settingsChanged",
            toExtensionWithIdentifier: extensionIdentifier
        )
    }
}
