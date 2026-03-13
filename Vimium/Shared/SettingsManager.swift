import Foundation

class SettingsManager {
    static let shared = SettingsManager()

    private static let appGroupID = "group.com.brokenalarms.Vimium"
    private static let keyBindingModeKey = "keyBindingMode"
    private static let themeKey = "theme"

    private let defaults: UserDefaults

    init() {
        defaults = UserDefaults(suiteName: Self.appGroupID) ?? .standard
    }

    var keyBindingMode: String {
        get { defaults.string(forKey: Self.keyBindingModeKey) ?? "location" }
        set { defaults.set(newValue, forKey: Self.keyBindingModeKey) }
    }

    var theme: String {
        get { defaults.string(forKey: Self.themeKey) ?? "auto" }
        set { defaults.set(newValue, forKey: Self.themeKey) }
    }
}
