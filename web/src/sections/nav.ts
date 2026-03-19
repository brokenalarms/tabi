import './nav.css'

export function createNav(): HTMLElement {
  const nav = document.createElement('nav')
  nav.className = 'nav'
  nav.innerHTML = `
    <div class="nav-inner container">
      <a href="#" class="nav-logo">Tabi</a>
      <div class="nav-links" id="nav-links">
        <a href="#how-it-works">How it works</a>
        <a href="#features">Features</a>
        <a href="#demo">Try it</a>
        <a href="#pricing">Pricing</a>
        <a href="#download" class="nav-cta">Get Tabi</a>
      </div>
      <button class="nav-mobile-toggle" id="nav-toggle" aria-label="Toggle menu">
        <span></span><span></span><span></span>
      </button>
    </div>
  `

  const toggle = nav.querySelector<HTMLButtonElement>('#nav-toggle')
  const links = nav.querySelector<HTMLElement>('#nav-links')
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('nav-links-open')
    })
  }

  return nav
}
