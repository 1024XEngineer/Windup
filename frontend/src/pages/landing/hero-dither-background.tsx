import { GodRays, PaperTexture } from '@paper-design/shaders-react'

import { useColorScheme } from '@/shared/hooks'

export function HeroDitherBackground() {
  const dark = useColorScheme() === 'dark'
  const shaderReady = typeof window !== 'undefined' && typeof WebGLRenderingContext !== 'undefined'

  return (
    <div aria-hidden="true" className="landing-hero-stage absolute inset-0 overflow-hidden">
      {shaderReady && (
        <>
          <GodRays
            className="absolute inset-0 h-full w-full"
            maxPixelCount={1280 * 720}
            colorBack={dark ? '#1e1e1e' : '#d1d0ca'}
            colorBloom={dark ? '#717171' : '#fff2d2'}
            colors={
              dark
                ? ['#5a5a5ab8', '#414141a3', '#686868a8']
                : ['#fff7ddb8', '#dddcd5a3', '#fffdf2a8']
            }
            bloom={0.66}
            intensity={0.72}
            density={0.07}
            spotty={0.74}
            midSize={0.3}
            midIntensity={0.4}
            speed={0.62}
            scale={1.28}
            rotation={-5}
            offsetX={-0.16}
            offsetY={-0.7}
          />
          <PaperTexture
            className="absolute inset-0 h-full w-full opacity-40"
            maxPixelCount={768 * 432}
            colorFront={dark ? '#686868' : '#b7b3a5'}
            colorBack={dark ? '#232323' : '#f5f1e6'}
            contrast={0.22}
            roughness={0.42}
            fiber={0.2}
            crumples={0.2}
            folds={0.15}
            drops={0.1}
            speed={0}
          />
        </>
      )}
    </div>
  )
}
