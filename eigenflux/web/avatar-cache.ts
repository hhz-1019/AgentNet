export interface AvatarPreview {
  avatar: string;
  preview?: string;
  color?: string;
}
export class AvatarCache {
  private entries = new Map<
    string,
    { value: string; expires: number; image?: AvatarPreview }
  >();
  get(key: string) {
    return this.entries.get(key)?.value;
  }
  fresh(key: string, now = Date.now()) {
    return (this.entries.get(key)?.expires ?? 0) > now;
  }
  image(key: string) {
    return this.entries.get(key)?.image;
  }
  set(key: string, value: string, now = Date.now(), image?: AvatarPreview) {
    const previous = this.entries.get(key);
    const nextImage =
      image?.avatar === value
        ? image
        : previous?.value === value
          ? previous.image
          : undefined;
    const changed =
      previous?.value !== value ||
      JSON.stringify(previous?.image) !== JSON.stringify(nextImage);
    this.entries.set(key, {
      value,
      image: nextImage,
      expires: now + (value ? 300_000 : 15_000),
    });
    return changed;
  }
  clear() {
    this.entries.clear();
  }
}
