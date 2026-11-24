<script setup lang="ts">
import { ArrowUpRight } from 'lucide-vue-next'
defineProps<{ first: string, second: string, description: string, portfolio: string, portal: string }>()

const dust = Array.from({ length: 53 }, (_, index) => ({
  x: `${(index * 73 + 9) % 99}%`,
  y: `${(index * 47 + 3) % 96}%`,
  opacity: `${((index * 7) % 6 + 2) / 14}`,
  size: index % 7 === 0 ? '3px' : '1px',
}))

const tilt = ref({ x: 0, y: 0 })
function tiltOrb(event: PointerEvent) {
  if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  tilt.value = {
    x: ((event.clientX - bounds.left) / bounds.width - .5) * 16,
    y: ((event.clientY - bounds.top) / bounds.height - .5) * 16,
  }
}
</script>

<template>
  <aside class="brand-panel" aria-labelledby="brand-title"
    @pointermove="tiltOrb" @pointerleave="tilt = { x: 0, y: 0 }">
    <div class="brand-grid" aria-hidden="true" />
    <div class="brand-inner">
      <div class="brand-wordmark">
        <span class="brand-icon"><img width="31" height="31" src="/favicon.png" alt=""></span>
        <div><strong>OB Auth</strong><span>{{ portal }}</span></div>
      </div>
      <div class="brand-message">
        <h1 id="brand-title">{{ first }}<br><span>{{ second }}</span></h1>
        <p>{{ description }}</p>
      </div>
      <div class="orbit-scene" aria-hidden="true" :style="{ '--dx': tilt.x + 'px', '--dy': tilt.y + 'px' }">
        <i v-for="(star, index) in dust" :key="index" class="star"
          :style="{ left: star.x, top: star.y, opacity: star.opacity, width: star.size, height: star.size }" />
        <div class="orb-halo" />
        <div class="orb-core" />
        <div class="orb-ring orb-ring-first"><i /></div>
        <div class="orb-ring orb-ring-second"><i /></div>
        <div class="orb-ring orb-ring-third"><i /></div>
      </div>
      <a class="portfolio-link" href="https://www.oscarbahamonde.com" rel="noopener">
        {{ portfolio }} <ArrowUpRight :size="15" aria-hidden="true" />
      </a>
    </div>
  </aside>
</template>
