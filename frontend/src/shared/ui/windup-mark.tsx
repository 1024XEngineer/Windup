import { useId, type SVGProps } from 'react'

/** 内联标志跟随文字颜色；独立遮罩避免同页多个实例互相引用。 */
export function WindupMark(props: SVGProps<SVGSVGElement>) {
  const maskId = useId()
  return (
    <svg viewBox="0 0 256 256" aria-hidden="true" {...props}>
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
          <rect width="256" height="256" fill="#000" />
          <path
            fill="#fff"
            d="M18 181 57 147c6-8 11-17 15-28 11-30 37-48 69-49 11-22 32-35 56-32 25 3 44 23 47 48l12 8-15 13c-4 27-18 48-42 64-24 17-53 25-84 20-20-3-38-11-52-24L18 194l27-31-27 18Z"
          />
          <path
            d="M91 122c20-25 51-34 86-23 1 27-15 53-47 75-17-10-31-28-39-52Z"
            fill="none"
            stroke="#000"
            strokeWidth="7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="m116 146 32-28M130 160l33-30"
            fill="none"
            stroke="#000"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <circle cx="111" cy="127" r="8" fill="#000" />
          <circle cx="207" cy="76" r="5" fill="#000" />
          <path
            d="m53 160-21 22M67 168l-25 20"
            fill="none"
            stroke="#000"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </mask>
      </defs>
      <rect width="256" height="256" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  )
}
