import './download.css'

export function createDownload(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'download'
  section.id = 'download'
  section.innerHTML = `
    <div class="container download-inner" data-reveal>
      <h2 class="section-heading">Ready to retire your mouse?</h2>
      <p class="download-sub">One-time purchase. No account. No data collected.</p>
      <div class="download-cta">
        <a href="#" class="btn btn-primary btn-large">Download on the Mac App Store</a>
      </div>
      <p class="download-reqs">Requires macOS 13 (Ventura) or later and Safari.</p>
    </div>
  `
  return section
}
