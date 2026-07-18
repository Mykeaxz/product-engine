// shopify.js — Admin GraphQL client, scoped to a single brand's store + token.
// Credentials come from the brand record (per-brand), never a global env var.

export function shopifyClient(brand) {
  const store = brand.shopify_store;
  const token = brand.shopify_admin_token;
  const version = brand.shopify_api_version || '2025-01';
  if (!store || !token) throw new Error('brand has no Shopify store/token connected');

  async function gql(query, variables = {}) {
    const res = await fetch(`https://${store}/admin/api/${version}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors) throw new Error('shopify gql: ' + JSON.stringify(json.errors));
    const userErrors = firstUserErrors(json.data);
    if (userErrors?.length) throw new Error('shopify userErrors: ' + JSON.stringify(userErrors));
    return json.data;
  }

  return { gql, store, version };
}

function firstUserErrors(data) {
  if (!data) return null;
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (v && Array.isArray(v.userErrors) && v.userErrors.length) return v.userErrors;
  }
  return null;
}

// Fetch existing product titles for name-collision checking.
export async function listProductTitles(brand, limit = 250) {
  const { gql } = shopifyClient(brand);
  const data = await gql(
    `query($n:Int!){ products(first:$n){ edges{ node{ title } } } }`,
    { n: limit }
  );
  return data.products.edges.map((e) => e.node.title);
}
