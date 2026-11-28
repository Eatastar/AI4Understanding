export function BrandLogo({ size, className }: { size: number | string; className?: string }) {
  return <img className={className} src={import.meta.env.VITE_BRAND_LOGO_URL} alt=""
    style={{ width: size, height: size, flexShrink: 0 }} />;
}
