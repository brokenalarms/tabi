import './footer.css'

export function createFooter(): HTMLElement {
  const footer = document.createElement('footer')
  footer.className = 'footer'
  footer.innerHTML = `
    <div class="container footer-inner">
      <div class="footer-top">
        <div class="footer-brand">Tabi</div>
        <div class="footer-links">
          <a href="#">Privacy</a>
          <a href="#">Support</a>
          <a href="https://github.com/brokenalarms/vimium-mac">GitHub</a>
        </div>
      </div>
      <p class="footer-note">
        Tabi works on every standard website. Some embedded content (iframes, cross-origin widgets)
        and Apple's built-in Safari pages are not accessible to any extension.
      </p>
      <p class="footer-copy">Made by <a href="https://github.com/brokenalarms">brokenalarms</a></p>
    </div>
  `
  return footer
}
