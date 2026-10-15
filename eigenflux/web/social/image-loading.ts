// Resize only media served by our permission-checked endpoints, never remote URLs.
export function imageSources(url: string, detail = false) {
  if (
    !/^\/api\/v2\/(?:console\/social\/media\/\d+|guest\/posts\/\d+\/media\/\d+)$/.test(
      url,
    )
  )
    return { src: url };
  return {
    src: `${url}?w=${detail ? 1440 : 640}`,
    srcSet: [320, 640, 960, 1440]
      .map((width) => `${url}?w=${width} ${width}w`)
      .join(', '),
    sizes: detail
      ? '(max-width: 800px) 100vw, 60vw'
      : '(max-width: 600px) 50vw, (max-width: 1100px) 33vw, 320px',
  };
}

export function imageLead(viewport: number, slow = false) {
  return Math.round(
    Math.min(3000, Math.max(800, viewport * (slow ? 2 : 1.25))),
  );
}
