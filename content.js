console.log('[dHunt] Content script injected on', window.location.href);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    switch (msg.action) {
      case 'ping':
        sendResponse({ host: window.location.hostname });
        break;
      case 'extractListings':
        sendResponse(extractListings());
        break;
      case 'extractProductDetails':
        sendResponse(extractProductDetails());
        break;
      case 'getNextPageUrl':
        sendResponse({ url: getNextPageUrl() });
        break;
    }
  } catch (e) {
    sendResponse({ error: e.message });
  }
  return true;
});

// ── Search results extraction ─────────────────────────────────────────────────

function extractListings() {
  const cardSelectors = [
    '[data-qa-locator="product-item"]',
    '[class*="gridItem"]',
    '[class*="grid-item"]',
    'div[class*="product"] li[class]',
    '#root ul > li[class]',
    'li[data-item-id]'
  ];

  let cards = [];
  for (const sel of cardSelectors) {
    try {
      const found = Array.from(document.querySelectorAll(sel));
      const valid = found.filter(el => el.querySelector('a[href]'));
      if (valid.length > 3) { cards = valid; break; }
    } catch (e) {}
  }

  const products = [];
  const seenUrls = new Set();

  for (const card of cards) {
    try {
      // URL
      const link = (
        card.querySelector('a[href*=".html"]') ||
        card.querySelector('a[href*="/products/"]') ||
        card.querySelector('a[href*="daraz.pk"]') ||
        card.querySelector('a[href]')
      );
      if (!link) continue;

      let url = link.getAttribute('href') || '';
      if (url.startsWith('//')) url = 'https:' + url;
      else if (url.startsWith('/')) url = 'https://www.daraz.pk' + url;
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);

      // Title
      const titleEl = (
        card.querySelector('[title]') ||
        card.querySelector('[class*="title"] a, [class*="name"] a') ||
        card.querySelector('h2, h3') ||
        link
      );
      const title = (
        (titleEl && titleEl.getAttribute('title')) ||
        (titleEl && titleEl.textContent) ||
        ''
      ).trim();
      if (!title || title.length < 3) continue;

      // Price
      const priceEl = (
        card.querySelector('[class*="price"] [class*="currency"]') ||
        card.querySelector('[class*="price_color"]') ||
        card.querySelector('[class*="price"]')
      );
      const price = priceEl ? priceEl.textContent.trim().replace(/\s+/g, ' ') : '';

      // Rating
      let rating = '';
      const starsEl = card.querySelector('[class*="stars"], [class*="rating"]');
      if (starsEl) {
        const inner = starsEl.querySelector('[style*="width"]') || starsEl;
        const wm = (inner.getAttribute('style') || '').match(/width:\s*([0-9.]+)%/);
        if (wm) rating = (parseFloat(wm[1]) / 20).toFixed(1);
        if (!rating) {
          const am = (starsEl.getAttribute('aria-label') || '').match(/([0-9.]+)\s*(?:out of|\/)\s*5/i);
          if (am) rating = am[1];
        }
      }

      // Review count
      const reviewEl = (
        card.querySelector('[class*="count"]') ||
        card.querySelector('[class*="review"]') ||
        card.querySelector('[class*="rating"] + span')
      );
      const reviews = reviewEl ? reviewEl.textContent.replace(/[^0-9]/g, '') : '';

      // Free shipping
      const cardText = (card.textContent || '').toLowerCase();
      const freeShipEl = (
        card.querySelector('[class*="free-ship"], [class*="freeShip"]') ||
        card.querySelector('[class*="tag"][class*="free"]') ||
        card.querySelector('[title*="Free Shipping" i]')
      );
      const freeShipping = !!(freeShipEl || cardText.includes('free shipping') || cardText.includes('free deliver'));

      products.push({ title, url, price, rating, reviews, freeShipping });
    } catch (e) {
      // skip bad card
    }
  }

  return { products, count: products.length };
}

// ── Pagination ────────────────────────────────────────────────────────────────

function getNextPageUrl() {
  const nextSelectors = [
    '[class*="ant-pagination-next"]:not([class*="disabled"]) a',
    'li[class*="next"]:not([class*="disabled"]) a',
    'a[class*="next"]:not([disabled])',
    '[aria-label*="next" i] a',
    '[title*="next" i]'
  ];
  for (const sel of nextSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        let href = el.getAttribute('href') || el.href || '';
        if (href.startsWith('/')) href = 'https://www.daraz.pk' + href;
        if (href) return href;
      }
    } catch (e) {}
  }

  const params = new URLSearchParams(window.location.search);
  const nextPage = parseInt(params.get('page') || '1') + 1;

  for (const link of document.querySelectorAll('a[href*="page="]')) {
    try {
      const u = new URL(link.href);
      if (u.searchParams.get('page') === String(nextPage)) return link.href;
    } catch (e) {}
  }

  if (window.location.pathname.includes('/catalog') || params.has('page') || params.has('q')) {
    const nextParams = new URLSearchParams(window.location.search);
    nextParams.set('page', String(nextPage));
    if (params.has('q') || params.has('search')) {
      return window.location.pathname + '?' + nextParams.toString();
    }
  }

  return null;
}

// ── Product detail extraction ─────────────────────────────────────────────────

function extractProductDetails() {
  function first(...selectors) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const t = (el.getAttribute('title') || el.textContent || '').trim();
          if (t) return t;
        }
      } catch (e) {}
    }
    return '';
  }

  // Title
  const title = first(
    'h1[class*="pdp-mod-product-badge-title"]',
    '[class*="pdp-title"]',
    'h1[class*="title"]',
    '[class*="product-title"] h1',
    'h1'
  );

  // Current price
  const currentPrice = first(
    '[class*="pdp-price_size_xl"]',
    '[class*="pdp-price_color_orange"]',
    '[class*="pdp-price"][class*="color_orange"]',
    '[class*="price_color_orange"]',
    '[class*="pdp-price"]:not([class*="deleted"]):not([class*="origin"])',
    '[class*="price"]'
  );

  // Original / struck-through price
  const originalPrice = first(
    '[class*="pdp-price_type_deleted"]',
    '[class*="price_type_deleted"]',
    '[class*="origin-price"]',
    'del[class*="price"]',
    's[class*="price"]',
    'del'
  );

  // Discount %
  let discountPct = first('[class*="discount"][class*="percent"]', '[class*="percent-off"]');
  const discMatch = discountPct.match(/(\d+)\s*%/);
  discountPct = discMatch ? discMatch[1] + '%' : '';
  if (!discountPct && currentPrice && originalPrice) {
    const cur = parseFloat(currentPrice.replace(/[^0-9.]/g, ''));
    const ori = parseFloat(originalPrice.replace(/[^0-9.]/g, ''));
    if (ori > 0 && cur > 0 && ori > cur) {
      discountPct = Math.round((1 - cur / ori) * 100) + '%';
    }
  }

  // Rating
  let rating = first(
    '[class*="score-average"]',
    '[class*="pdp-review"] [class*="average"]',
    '[class*="rating"] [class*="score"]',
    '[class*="score"] span'
  );
  const ratingMatch = rating.match(/([0-9.]+)/);
  rating = ratingMatch ? ratingMatch[1] : '';

  // Review count
  let reviewCount = '';
  const rcEl = document.querySelector(
    '[class*="pdp-review-count"], [class*="count-review"], [class*="review-count"]'
  );
  if (rcEl) reviewCount = rcEl.textContent.replace(/[^0-9]/g, '');
  if (!reviewCount) {
    const m = (document.body.innerText || '').match(/\(?\s*([0-9,]+)\s*(?:Ratings?|Reviews?|ratings?)\s*\)?/);
    if (m) reviewCount = m[1].replace(/,/g, '');
  }

  // Stock status
  const soldOutEl = document.querySelector(
    '[class*="sold-out"], [class*="soldOut"], [class*="out-of-stock"], [class*="outOfStock"]'
  );
  let stockStatus = soldOutEl ? 'Out of Stock' : '';
  if (!stockStatus) {
    const addToCartBtn = document.querySelector(
      '[data-qa-locator="add-to-cart"], [class*="add-to-cart"], [class*="btn-cart"]'
    );
    stockStatus = addToCartBtn ? 'In Stock' : 'Unknown';
  }
  const lowStockEl = document.querySelector(
    '[class*="low-stock"], [class*="lowStock"], [class*="onlyLeft"], [class*="hurry"]'
  );
  if (lowStockEl) {
    const m = lowStockEl.textContent.match(/(\d+)\s*(?:left|piece|item)/i);
    stockStatus = m ? `Low Stock (${m[1]} left)` : 'Low Stock';
  }

  // Mall badge
  const isMall = !!(
    document.querySelector('[class*="lazmall"], [class*="LazMall"], [class*="darazMall"]') ||
    document.querySelector('[alt*="Daraz Mall" i], [alt*="LazMall" i]') ||
    document.querySelector('[class*="mall-icon"], [class*="mallIcon"]')
  );

  // Seller
  const sellerEl = document.querySelector(
    '[class*="seller-name"] a, [class*="pdp-seller"] a, ' +
    '[class*="shop-name"] a, [class*="store-name"] a, [class*="sold-by"] a'
  );
  const seller = sellerEl ? sellerEl.textContent.trim() : '';

  // ── Extended fields ───────────────────────────────────────────────────────

  // Category (breadcrumb — skip first "Home" crumb)
  const crumbs = Array.from(document.querySelectorAll(
    '[class*="breadcrumb"] a, [class*="Breadcrumb"] a, nav[aria-label*="breadcrumb" i] a'
  ));
  const category = crumbs.length > 1
    ? crumbs.slice(1, -1).map(b => b.textContent.trim()).filter(Boolean).join(' > ')
    : (crumbs.length === 1 ? crumbs[0].textContent.trim() : '');

  // Brand — dedicated element first, then specs table
  let brand = first(
    '[class*="pdp-brand"] a',
    '[class*="brand-name"] a',
    '[class*="pdp-header-store-info"] a'
  );
  if (!brand) {
    const specRows = document.querySelectorAll(
      '[class*="specification"] tr, [class*="Specification"] tr, [class*="pdp-props"] tr'
    );
    for (const row of specRows) {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 2 && /brand/i.test(cells[0].textContent)) {
        brand = cells[1].textContent.trim();
        break;
      }
    }
  }

  // Images count — count gallery thumbnails
  let imagesCount = document.querySelectorAll(
    '[class*="item-gallery__image-item"], [class*="gallery"] [class*="thumb"] img'
  ).length;
  if (imagesCount === 0) {
    imagesCount = document.querySelectorAll(
      '[class*="pdp-mod-main-pic"] img, [class*="gallery-preview"] img'
    ).length;
  }

  // Video available
  const videoAvailable = !!(
    document.querySelector('video') ||
    document.querySelector('[class*="pdp-video"], [class*="video-player"], [class*="pdp-video-btn"]')
  );

  // Description length
  const descEl = document.querySelector(
    '[class*="pdp-product-desc"], [class*="detail-desc"], [class*="pdp-block__desc-content"]'
  );
  const descriptionLength = descEl ? (descEl.innerText || descEl.textContent || '').trim().length : 0;

  // Specifications count
  const specificationsCount = document.querySelectorAll(
    '[class*="pdp-props"] tr, [class*="specification"] tr, ' +
    '[class*="Specifications"] tr, [class*="pdp-specifications"] tr'
  ).length;

  // Variants count (non-disabled options)
  const variantsCount = document.querySelectorAll(
    '[class*="sku-variable"] li:not([class*="disabled"]), ' +
    '[class*="pdp-mod-sku"] [class*="sku-variable"] > ul > li'
  ).length;

  return {
    title,
    currentPrice,
    originalPrice,
    discountPct,
    rating,
    reviewCount,
    stockStatus,
    isMall,
    seller,
    url: window.location.href,
    category,
    brand,
    imagesCount,
    videoAvailable,
    descriptionLength,
    specificationsCount,
    variantsCount
  };
}
