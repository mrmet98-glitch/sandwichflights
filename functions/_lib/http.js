export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export function errorJson(error, fallback = 'Request failed') {
  console.error(error);
  const status = Number(error?.status);
  return json(
    { error: error?.message || fallback, details: error?.payload || null },
    Number.isFinite(status) && status >= 400 && status < 600 ? status : 500
  );
}
