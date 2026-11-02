// A successful HTTP request is not, by itself, proof of publication.
export function publishedReceipt(value) {
  if (
    !value ||
    typeof value.id !== 'string' ||
    !/^[1-9][0-9]*$/.test(value.id) ||
    value.state !== 'published'
  )
    throw new Error('Publication not confirmed by a valid post receipt');
  return value;
}
