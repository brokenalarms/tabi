// Domain exclusion tests — verifies that Vimium is disabled on excluded domains.
// Tests the isDomainExcluded matching logic used in content.js.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Extract the matching logic from content.js for unit testing
function isDomainExcluded(hostname, excludedDomains) {
    const host = hostname.toLowerCase();
    for (const pattern of excludedDomains) {
        if (host === pattern || host.endsWith("." + pattern)) {
            return true;
        }
    }
    return false;
}

describe("isDomainExcluded", () => {
    it("returns false for empty exclusion list", () => {
        assert.equal(isDomainExcluded("example.com", []), false);
    });

    it("matches exact domain", () => {
        assert.equal(isDomainExcluded("example.com", ["example.com"]), true);
    });

    it("matches subdomain of excluded domain", () => {
        assert.equal(isDomainExcluded("mail.example.com", ["example.com"]), true);
    });

    it("matches deeply nested subdomain", () => {
        assert.equal(isDomainExcluded("a.b.c.example.com", ["example.com"]), true);
    });

    it("does not match partial domain names", () => {
        // "notexample.com" should not match "example.com"
        assert.equal(isDomainExcluded("notexample.com", ["example.com"]), false);
    });

    it("does not match unrelated domains", () => {
        assert.equal(isDomainExcluded("other.com", ["example.com"]), false);
    });

    it("checks multiple exclusion entries", () => {
        const excluded = ["github.com", "twitter.com", "youtube.com"];
        assert.equal(isDomainExcluded("github.com", excluded), true);
        assert.equal(isDomainExcluded("youtube.com", excluded), true);
        assert.equal(isDomainExcluded("example.com", excluded), false);
    });

    it("is case-insensitive", () => {
        assert.equal(isDomainExcluded("Example.COM", ["example.com"]), true);
    });
});
