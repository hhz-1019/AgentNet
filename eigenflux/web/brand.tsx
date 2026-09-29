/** The supplied wordmark is shared across the console and public identity cards. */
export function BrandLogo({ inverse = false }: { inverse?: boolean }) {
  return (
    <img
      className={`brand-logo${inverse ? ' brand-logo-inverse' : ''}`}
      src="/brand/wordmark.svg"
      alt="elsewhere"
      width="1001"
      height="210"
    />
  );
}
