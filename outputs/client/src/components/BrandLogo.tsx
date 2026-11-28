export function BrandLogo({ size, className }: { size: number; className?: string }) {
  return <img className={className} src={import.meta.env.VITE_BRAND_LOGO_URL} alt="" width={size} height={size} />;
}
