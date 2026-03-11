import Foundation

class SettingsManager {
    static let shared = SettingsManager()

    private static let appGroupID = "group.com.anthropic.Vimium"
    private static let excludedDomainsKey = "excludedDomains"

    private let defaults: UserDefaults

    init() {
        defaults = UserDefaults(suiteName: Self.appGroupID) ?? .standard
    }

    var excludedDomains: [String] {
        get { defaults.stringArray(forKey: Self.excludedDomainsKey) ?? [] }
        set { defaults.set(newValue, forKey: Self.excludedDomainsKey) }
    }
}
