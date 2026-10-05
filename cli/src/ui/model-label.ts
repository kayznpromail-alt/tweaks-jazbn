/** Presentation only: API identifiers and saved records remain unchanged. */
export function modelLabel(id: string): string {
  const product = /^(?:[a-z][a-z0-9_-]*)?(BEAST|GPT)$/i.exec(id)?.[1];
  return product ? `edgey${product.toUpperCase()}` : id;
}
