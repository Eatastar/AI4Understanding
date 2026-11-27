export function BrandLogo({ size, className }: { size: number; className?: string }) {
  return <img className={className} src="/assets/ai4u-logo.svg" alt="" width={size} height={size} />;
}
