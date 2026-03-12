import Foundation

class SettingsManager {
    static let shared = SettingsManager()

    private static let appGroupID = "group.com.anthropic.Vimium"
    private static let excludedDomainsKey = "excludedDomains"
    private static let keyBindingModeKey = "keyBindingMode"
    private static let themeKey = "theme"

    private let defaults: UserDefaults

    init() {
        defaults = UserDefaults(suiteName: Self.appGroupID) ?? .standard
    }

    var excludedDomains: [String] {
        get { defaults.stringArray(forKey: Self.excludedDomainsKey) ?? [] }
        set { defaults.set(newValue, forKey: Self.excludedDomainsKey) }
    }

    var keyBindingMode: String {
        get { defaults.string(forKey: Self.keyBindingModeKey) ?? "location" }
        set { defaults.set(newValue, forKey: Self.keyBindingModeKey) }
    }

    var theme: String {
        get { defaults.string(forKey: Self.themeKey) ?? "yellow" }
        set { defaults.set(newValue, forKey: Self.themeKey) }
    }
}
