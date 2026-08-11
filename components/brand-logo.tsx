type BrandLogoProps = {
  variant?: 'wordmark' | 'mark'
  className?: string
  priority?: boolean
}

export function BrandLogo({
  variant = 'wordmark',
  className = '',
  priority = false,
}: BrandLogoProps) {
  const isMark = variant === 'mark'

  return (
    <Image
      src={isMark ? '/trade-karo-mark.png' : '/trade-karo-logo.png'}
      alt="Trade-karo"
      width={isMark ? 205 : 986}
      height={205}
      priority={priority}
      className={`block object-contain ${className}`}
    />
  )
}
import Image from 'next/image'
