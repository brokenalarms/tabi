import StoreKit
import os.log

@MainActor
final class StoreManager: ObservableObject {
    static let shared = StoreManager()

    private static let productID = "com.brokenalarms.tabi.premium"
    private static let appGroupID = "group.com.brokenalarms.tabi"
    private static let isPremiumKey = "isPremium"

    @Published private(set) var isPremium = false
    @Published private(set) var product: Product?
    @Published private(set) var purchaseState: PurchaseState = .idle

    enum PurchaseState: Equatable {
        case idle
        case purchasing
        case purchased
        case failed(String)
    }

    private var transactionListener: Task<Void, Never>?

    private init() {
        isPremium = Self.readPremiumStatus()
        transactionListener = listenForTransactions()
        Task { await loadProduct() }
        Task { await refreshEntitlements() }
    }

    deinit {
        transactionListener?.cancel()
    }

    // MARK: - Product Loading

    func loadProduct() async {
        do {
            let products = try await Product.products(for: [Self.productID])
            product = products.first
        } catch {
            os_log(.error, "Failed to load products: %@", error.localizedDescription)
        }
    }

    // MARK: - Purchase

    func purchase() async {
        guard let product else { return }
        purchaseState = .purchasing

        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                let transaction = try checkVerified(verification)
                await transaction.finish()
                setPremium(true)
                purchaseState = .purchased
            case .userCancelled:
                purchaseState = .idle
            case .pending:
                purchaseState = .idle
            @unknown default:
                purchaseState = .idle
            }
        } catch {
            purchaseState = .failed(error.localizedDescription)
            os_log(.error, "Purchase failed: %@", error.localizedDescription)
        }
    }

    // MARK: - Restore

    func restore() async {
        try? await AppStore.sync()
        await refreshEntitlements()
    }

    // MARK: - Entitlements

    private func refreshEntitlements() async {
        var foundPremium = false
        for await result in Transaction.currentEntitlements {
            if let transaction = try? checkVerified(result),
               transaction.productID == Self.productID,
               transaction.revocationDate == nil {
                foundPremium = true
            }
        }
        setPremium(foundPremium)
    }

    // MARK: - Transaction Listener

    private func listenForTransactions() -> Task<Void, Never> {
        Task.detached { [weak self] in
            for await result in Transaction.updates {
                if let transaction = try? self?.checkVerified(result) {
                    let isPurchased = transaction.revocationDate == nil
                    await self?.setPremium(isPurchased)
                    await transaction.finish()
                }
            }
        }
    }

    // MARK: - Verification

    nonisolated private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let value):
            return value
        }
    }

    // MARK: - Persistence

    private func setPremium(_ value: Bool) {
        isPremium = value
        let defaults = UserDefaults(suiteName: Self.appGroupID)
        defaults?.set(value, forKey: Self.isPremiumKey)
    }

    private static func readPremiumStatus() -> Bool {
        UserDefaults(suiteName: appGroupID)?.bool(forKey: isPremiumKey) ?? false
    }
}
