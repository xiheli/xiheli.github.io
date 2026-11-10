/* ============================================================
   Chronicle — 交互脚本
   深浅色、首页分类筛选、搜索、目录、代码复制、阅读进度
   ============================================================ */

(function () {
  'use strict';

  var root = typeof window.SITE_ROOT === 'string' ? window.SITE_ROOT : '/';
  if (root.charAt(root.length - 1) !== '/') root += '/';

  var html = document.documentElement;
  var $ = function (selector, context) { return (context || document).querySelector(selector); };
  var $$ = function (selector, context) {
    return Array.prototype.slice.call((context || document).querySelectorAll(selector));
  };

  var prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 深浅色 ---------- */

  var THEME_KEY = 'chronicle-theme';

  function readTheme() {
    try {
      return window.localStorage.getItem(THEME_KEY);
    } catch (error) {
      return null;
    }
  }

  function saveTheme(theme) {
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* 忽略无痕模式下的写入失败 */
    }
  }

  function syncThemeButton() {
    var button = $('#theme-toggle');
    if (!button) return;
    var isDark = html.getAttribute('data-theme') === 'dark';
    button.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    button.setAttribute('title', isDark ? '切换到浅色模式' : '切换到深色模式');
  }

  syncThemeButton();

  var themeButton = $('#theme-toggle');
  if (themeButton) {
    themeButton.addEventListener('click', function () {
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      saveTheme(next);
      syncThemeButton();
    });
  }

  if (window.matchMedia) {
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    var onSchemeChange = function (event) {
      if (readTheme()) return;
      html.setAttribute('data-theme', event.matches ? 'dark' : 'light');
      syncThemeButton();
    };
    if (scheme.addEventListener) scheme.addEventListener('change', onSchemeChange);
    else if (scheme.addListener) scheme.addListener(onSchemeChange);
  }

  /* ---------- 顶栏滚动状态 ---------- */

  var masthead = $('#masthead');
  var toTop = $('#to-top');
  var ticking = false;

  function onScrollFrame() {
    var y = window.pageYOffset || html.scrollTop;
    if (masthead) masthead.classList.toggle('is-stuck', y > 4);
    if (toTop) toTop.hidden = y < 640;
    updateProgress();
    ticking = false;
  }

  function requestScrollUpdate() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(onScrollFrame);
  }

  window.addEventListener('scroll', requestScrollUpdate, { passive: true });
  requestScrollUpdate();

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    });
  }

  /* ---------- 阅读进度 ---------- */

  var progressArticle = $('.post') || $('.page-layout');
  var progressBar = $('#reading-progress-bar');

  function updateProgress() {
    if (!progressBar || !progressArticle) return;
    var rect = progressArticle.getBoundingClientRect();
    var viewport = window.innerHeight || html.clientHeight;
    var pageTop = rect.top + (window.pageYOffset || html.scrollTop);
    var start = pageTop + 20;
    var end = pageTop + rect.height - viewport;
    var scrollTop = window.pageYOffset || html.scrollTop;
    var ratio = (scrollTop - start) / Math.max(1, end - start);
    ratio = Math.max(0, Math.min(1, ratio));
    progressBar.style.width = (ratio * 100).toFixed(2) + '%';
  }

  updateProgress();

  /* ---------- 首页分类筛选 ---------- */

  var filterBar = $('#filters');

  if (filterBar) {
    var chips = $$('.chip[data-cat]', filterBar);
    var logs = $$('.log');
    var months = $$('.month');
    var status = $('#filter-status');
    var empty = $('#stream-empty');
    var totalCount = logs.length;
    var activeCat = '*';

    var normalize = function (value) { return String(value || '').trim(); };

    var applyFilter = function (cat, syncHash) {
      activeCat = cat || '*';
      var visibleTotal = 0;

      logs.forEach(function (log) {
        var cats = normalize(log.getAttribute('data-cats')).split('|');
        var match = activeCat === '*' || cats.indexOf(activeCat) !== -1;
        log.classList.toggle('is-hidden', !match);
        if (match) visibleTotal += 1;
      });

      months.forEach(function (month) {
        var visible = $$('.log:not(.is-hidden)', month).length;
        month.classList.toggle('is-empty', visible === 0);
        var counter = $('.month-count', month);
        if (counter) {
          counter.textContent = visible === Number(counter.getAttribute('data-count'))
            ? visible + ' 条'
            : visible + ' / ' + counter.getAttribute('data-count') + ' 条';
        }
      });

      chips.forEach(function (chip) {
        var isActive = normalize(chip.getAttribute('data-cat')) === activeCat;
        chip.classList.toggle('is-active', isActive);
        chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });

      if (status) {
        status.textContent = activeCat === '*'
          ? '共 ' + totalCount + ' 条记录'
          : activeCat + ' · ' + visibleTotal + ' / ' + totalCount + ' 条';
      }

      if (empty) empty.hidden = visibleTotal !== 0;

      if (syncHash) {
        var url = window.location.pathname + window.location.search;
        if (activeCat === '*') {
          history.replaceState(null, '', url);
        } else {
          history.replaceState(null, '', url + '#cat=' + encodeURIComponent(activeCat));
        }
      }
    };

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        applyFilter(normalize(chip.getAttribute('data-cat')), true);
      });
    });

    var hash = window.location.hash || '';
    var match = /^#cat=(.+)$/.exec(hash);
    if (match) {
      var initial = decodeURIComponent(match[1]);
      applyFilter(initial, false);
    }
  }

  /* ---------- 搜索 ---------- */

  var searchModal = $('#search-modal');
  var searchInput = $('#search-input');
  var searchResults = $('#search-results');
  var searchHint = $('#search-hint');
  var searchEmpty = $('#search-empty');
  var searchIndex = null;
  var searchLoading = null;
  var searchLimit = Number(searchModal && searchModal.getAttribute('data-limit')) || 20;
  var activeResult = -1;
  var lastFocused = null;

  function highlightInto(element, text, query) {
    if (!query) {
      element.textContent = text;
      return;
    }
    var lower = String(text).toLowerCase();
    var needle = String(query).toLowerCase();
    var index = lower.indexOf(needle);
    if (index === -1) {
      element.textContent = text;
      return;
    }
    var fragment = document.createDocumentFragment();
    var cursor = 0;
    while (index !== -1) {
      if (index > cursor) fragment.appendChild(document.createTextNode(text.slice(cursor, index)));
      var mark = document.createElement('mark');
      mark.textContent = text.slice(index, index + needle.length);
      fragment.appendChild(mark);
      cursor = index + needle.length;
      index = lower.indexOf(needle, cursor);
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    element.textContent = '';
    element.appendChild(fragment);
  }

  function loadSearchIndex() {
    if (searchIndex) return Promise.resolve(searchIndex);
    if (searchLoading) return searchLoading;
    searchLoading = fetch(root + 'search.json', { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        searchIndex = Array.isArray(data) ? data : [];
        if (searchHint) searchHint.textContent = '共 ' + searchIndex.length + ' 条记录 · 输入关键词开始搜索';
        return searchIndex;
      })
      .catch(function () {
        searchIndex = [];
        if (searchHint) searchHint.textContent = '搜索索引加载失败，请刷新页面重试。';
        return searchIndex;
      });
    return searchLoading;
  }

  function scoreItem(item, query) {
    var q = query.toLowerCase();
    var score = 0;
    var title = String(item.t || '').toLowerCase();
    var cats = (item.c || []).join(' ').toLowerCase();
    var tags = (item.g || []).join(' ').toLowerCase();
    var body = String(item.x || '').toLowerCase();

    if (title.indexOf(q) !== -1) score += title.startsWith(q) ? 12 : 8;
    if (cats.indexOf(q) !== -1) score += 5;
    if (tags.indexOf(q) !== -1) score += 4;
    if (body.indexOf(q) !== -1) score += 2;
    return score;
  }

  function renderResults(query) {
    if (!searchResults) return;
    searchResults.textContent = '';
    activeResult = -1;

    if (!query) {
      if (searchEmpty) searchEmpty.hidden = true;
      if (searchHint) searchHint.textContent = searchIndex ? '共 ' + searchIndex.length + ' 条记录 · 输入关键词开始搜索' : '正在加载搜索索引…';
      return;
    }

    var query_ = query.trim();
    if (!query_) return;

    var hits = searchIndex
      .map(function (item) { return { item: item, score: scoreItem(item, query_) }; })
      .filter(function (entry) { return entry.score > 0; })
      .sort(function (a, b) {
        return b.score - a.score || String(b.item.d).localeCompare(String(a.item.d));
      })
      .slice(0, searchLimit);

    if (!hits.length) {
      if (searchEmpty) searchEmpty.hidden = false;
      if (searchHint) searchHint.textContent = '0 条结果';
      return;
    }

    if (searchEmpty) searchEmpty.hidden = true;
    if (searchHint) searchHint.textContent = hits.length + ' 条结果 · 回车打开';

    var fragment = document.createDocumentFragment();
    hits.forEach(function (entry, index) {
      var item = entry.item;
      var li = document.createElement('li');
      li.className = 'search-result';
      li.dataset.index = String(index);

      var link = document.createElement('a');
      link.href = item.u || '#';

      var title = document.createElement('span');
      title.className = 'search-result-title';
      highlightInto(title, String(item.t || '(无标题)'), query_);

      var meta = document.createElement('span');
      meta.className = 'search-result-meta';
      var date = document.createElement('span');
      date.textContent = item.d || '';
      meta.appendChild(date);
      if (item.c && item.c.length) {
        var sep = document.createElement('span');
        sep.textContent = '·';
        meta.appendChild(sep);
        var cat = document.createElement('span');
        cat.textContent = item.c[0];
        meta.appendChild(cat);
      }

      link.appendChild(title);
      link.appendChild(meta);
      li.appendChild(link);
      fragment.appendChild(li);
    });

    searchResults.appendChild(fragment);
  }

  function setActiveResult(index) {
    if (!searchResults) return;
    var items = $$('.search-result', searchResults);
    if (!items.length) return;
    if (activeResult >= 0 && items[activeResult]) items[activeResult].classList.remove('is-active');
    activeResult = (index + items.length) % items.length;
    var current = items[activeResult];
    if (!current) return;
    current.classList.add('is-active');
    if (current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
  }

  function openSearch() {
    if (!searchModal) return;
    lastFocused = document.activeElement;
    searchModal.hidden = false;
    document.body.style.overflow = 'hidden';
    loadSearchIndex().then(function () {
      if (searchInput) {
        searchInput.focus();
        searchInput.select();
      }
      if (searchInput && searchInput.value.trim()) renderResults(searchInput.value);
    });
  }

  function closeSearch() {
    if (!searchModal || searchModal.hidden) return;
    searchModal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  $$('#search-open, #search-open-404').forEach(function (button) {
    button.addEventListener('click', openSearch);
  });

  if (searchModal) {
    $$('[data-search-close]', searchModal).forEach(function (element) {
      element.addEventListener('click', closeSearch);
    });
    var closeButton = $('#search-close');
    if (closeButton) closeButton.addEventListener('click', closeSearch);
  }

  var searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      var value = searchInput.value;
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () {
        if (searchIndex) renderResults(value);
      }, 90);
    });

    searchInput.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveResult(activeResult + 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveResult(activeResult - 1);
      } else if (event.key === 'Enter') {
        var items = searchResults ? $$('.search-result a', searchResults) : [];
        if (items.length) {
          event.preventDefault();
          var target = activeResult >= 0 ? items[activeResult] : items[0];
          if (target) window.location.href = target.getAttribute('href');
        }
      }
    });
  }

  document.addEventListener('keydown', function (event) {
    var key = event.key;
    var isTyping = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName || '');

    if ((event.ctrlKey || event.metaKey) && (key === 'k' || key === 'K')) {
      event.preventDefault();
      if (searchModal && !searchModal.hidden) closeSearch();
      else openSearch();
      return;
    }

    if (key === 'Escape') {
      if (searchModal && !searchModal.hidden) {
        event.preventDefault();
        closeSearch();
        return;
      }
    }

    if (!searchModal || searchModal.hidden) return;

    if (key === '/' && !isTyping) {
      event.preventDefault();
      if (searchInput) searchInput.focus();
    }
  });

  /* ---------- 文章目录 ---------- */

  var toc = $('#toc');
  var tocNav = $('#toc-nav');
  var postContent = $('#post-content');

  if (toc && tocNav && postContent) {
    var headings = $$('h2, h3', postContent);
    if (headings.length >= 2) {
      var usedIds = {};
      headings.forEach(function (heading, index) {
        if (!heading.id) {
          var text = (heading.textContent || '').trim().toLowerCase();
          var slug = text
            .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          if (!slug) slug = 'section';
          var candidate = slug;
          var counter = 1;
          while (usedIds[candidate]) {
            counter += 1;
            candidate = slug + '-' + counter;
          }
          usedIds[candidate] = true;
          heading.id = candidate;
        }
        var link = document.createElement('a');
        link.className = 'toc-link' + (heading.tagName === 'H3' ? ' toc-link--h3' : '');
        link.href = '#' + heading.id;
        link.textContent = heading.textContent;
        if (index === 0 && heading.tagName === 'H3') link.classList.remove('toc-link--h3');
        tocNav.appendChild(link);
      });

      toc.hidden = false;

      var linkFor = {};
      $$('.toc-link', tocNav).forEach(function (link) {
        linkFor[link.getAttribute('href').slice(1)] = link;
      });

      var setActiveLink = function (id) {
        $$('.toc-link', tocNav).forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('href') === '#' + id);
        });
      };

      if ('IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          var visible = entries
            .filter(function (entry) { return entry.isIntersecting; })
            .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
          if (visible.length) setActiveLink(visible[0].target.id);
        }, { rootMargin: '-90px 0px -68% 0px', threshold: 0 });
        headings.forEach(function (heading) { observer.observe(heading); });
      } else {
        window.addEventListener('scroll', function () {
          var current = headings[0];
          headings.forEach(function (heading) {
            if (heading.getBoundingClientRect().top < 120) current = heading;
          });
          if (current && current.id) setActiveLink(current.id);
        }, { passive: true });
      }

      tocNav.addEventListener('click', function (event) {
        var link = event.target.closest ? event.target.closest('.toc-link') : null;
        if (!link) return;
        event.preventDefault();
        var id = link.getAttribute('href').slice(1);
        var target = document.getElementById(id);
        if (!target) return;
        target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
        history.replaceState(null, '', '#' + id);
        setActiveLink(id);
      });
    }
  }

  /* ---------- 代码复制 ---------- */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch (error) {
      /* 忽略 */
    }
    document.body.removeChild(area);
  }

  $$('.post-content figure.highlight').forEach(function (figure) {
    var pre = $('pre', figure);
    if (!pre) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = '复制';
    button.setAttribute('aria-label', '复制代码');
    button.addEventListener('click', function () {
      copyText(pre.innerText).then(function () {
        button.textContent = '已复制';
        button.classList.add('is-copied');
        window.setTimeout(function () {
          button.textContent = '复制';
          button.classList.remove('is-copied');
        }, 1600);
      });
    });
    figure.appendChild(button);
  });

  /* ---------- 外部链接安全属性 ---------- */

  $$('a[target="_blank"]').forEach(function (link) {
    var rel = link.getAttribute('rel') || '';
    if (rel.indexOf('noopener') === -1) {
      link.setAttribute('rel', (rel + ' noopener').trim());
    }
  });

  /* ---------- 折叠过长分类（首页） ---------- */

  if (filterBar) {
    filterBar.addEventListener('keydown', function (event) {
      var chip = event.target.closest ? event.target.closest('.chip') : null;
      if (!chip) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        var buttons = $$('.chip[data-cat]', filterBar);
        var index = buttons.indexOf(chip);
        var next = event.key === 'ArrowRight' ? index + 1 : index - 1;
        if (next < 0) next = buttons.length - 1;
        if (next >= buttons.length) next = 0;
        if (buttons[next]) {
          event.preventDefault();
          buttons[next].focus();
        }
      }
    });
  }
})();
