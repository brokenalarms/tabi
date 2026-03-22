import './style.css'
import { createNav } from './sections/nav'
import { createHero } from './sections/hero'
import { createDemo } from './sections/demo'
import { createFeatures } from './sections/features'
import { createInterlude } from './sections/interlude'
import { createWhySafari } from './sections/why-safari'
import { createPricing } from './sections/pricing'
import { createDownload } from './sections/download'
import { createFooter } from './sections/footer'

function mount(): void {
  const app = document.getElementById('app')
  if (!app) return

  app.appendChild(createNav())
  app.appendChild(createHero())
  app.appendChild(createDemo())
  app.appendChild(createFeatures())
  app.appendChild(createInterlude())
  app.appendChild(createWhySafari())
  app.appendChild(createPricing())
  app.appendChild(createDownload())
  app.appendChild(createFooter())

  initReveal()
  initSmoothScroll()
}

function initReveal(): void {
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]')
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          (entry.target as HTMLElement).classList.add('visible')
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.15 }
  )
  targets.forEach((el) => observer.observe(el))
}

function initSmoothScroll(): void {
  document.addEventListener('click', (e) => {
    const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]')
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href || href === '#') return
    const target = document.querySelector(href)
    if (target) {
      e.preventDefault()
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
}

document.addEventListener('DOMContentLoaded', mount)
