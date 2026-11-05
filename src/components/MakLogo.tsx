/** Shared application mark; the generated bitmap is also embedded in the executable. */
export default function MakLogo({ size = 64 }: { size?: number; animated?: boolean; tone?: 'pink' | 'black' }) {
 return <img className="mak-logo" src="/assets/dev-space.png" width={size} height={size} alt="" aria-hidden="true" draggable={false} style={{display:'block',flexShrink:0,objectFit:'contain'}}/>
}
