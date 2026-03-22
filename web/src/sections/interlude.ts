import './interlude.css'

export function createInterlude(): HTMLElement {
  const section = document.createElement('section')
  section.className = 'interlude'
  section.innerHTML = `
    <div class="container">
      <h2 class="section-heading" data-reveal>But wait&hellip;</h2>
      <div class="interlude-grid">
        <div class="interlude-card" data-reveal>
          <h3>&ldquo;Why not just use Chrome?&rdquo;</h3>
          <p>Chrome is a great browser. But on a Mac, Safari gives you things Chrome <em>literally can&rsquo;t</em>:</p>
          <ul class="safari-bullets">
            <li>\uD83D\uDD10 Touch ID logins &amp; Passkeys</li>
            <li>\uD83D\uDCF2 One-time passwords from your iPhone &mdash; automatically</li>
            <li>\uD83D\uDCF1 iCloud tab sync across Mac, iPhone, iPad</li>
            <li>\uD83D\uDCB3 Apple Pay checkout &mdash; one click, no extensions</li>
            <li>\uD83D\uDD0B Hours more battery life</li>
            <li>\uD83D\uDEE1 Tracking prevention on by default</li>
          </ul>
          <p class="dim">Chrome is for everyone. Safari is for your Mac.</p>
        </div>
        <div class="interlude-card" data-reveal>
          <h3>&ldquo;What about Vimium?&rdquo;</h3>
          <p>We tried <em>everything</em> &mdash; every keyboard extension for every browser. Some had janky scrolling. Some broke on half the sites we visited. Some hadn&rsquo;t been updated in years.</p>
          <p>Tabi isn&rsquo;t a fork or a port. It&rsquo;s a clean implementation built for Safari &mdash; smooth scrolling, hints that actually land on the right elements, and a UI that doesn&rsquo;t make you wince.</p>
          <p>But the real difference is <em>tab sanity</em>. Fuzzy tab search finds any open tab instantly. Tab memory lets you retrace your steps. Marks jump to a site that&rsquo;s already open instead of spawning a duplicate. Together, they solve the problem every power user knows &mdash; fifty tabs deep, half of them the same site, and no idea where the one you need went.</p>
          <p class="dim">Same idea. Entirely different execution.</p>
        </div>
      </div>
    </div>
  `
  return section
}
