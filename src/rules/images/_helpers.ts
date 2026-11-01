import type { Img } from "../../model/types.js";

/** Images with an internal key (own files); data: URIs and external images are skipped. */
export function internalImages(
  images: readonly Img[],
): (Img & { key: string })[] {
  return images.filter((i): i is Img & { key: string } => i.key !== undefined);
}
