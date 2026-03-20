import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    private let settings = SettingsManager()

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any]

        let profile: UUID?
        if #available(macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = nil
        }

        os_log(
            .default,
            "Tabi extension received message from browser (profile: %@)",
            profile?.uuidString ?? "none"
        )

        let command = message?["command"] as? String
        let responseData: [String: Any]

        switch command {
        case "getSettings":
            responseData = [
                "keyBindingMode": settings.keyBindingMode,
                "theme": settings.theme,
                "isPremium": settings.isPremium,
            ]
        default:
            responseData = ["status": "ok"]
        }

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: responseData]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

}
