// "Help me choose": a short guided quiz that recommends cruise destinations
// based on the shopper's answers, then links to the SEO landing pages + quote.

(function () {
  const DEST = {
    caribbean: 'Caribbean', bahamas: 'Bahamas', mediterranean: 'Mediterranean', alaska: 'Alaska',
    mexico: 'Mexican Riviera', europe: 'Europe', hawaii: 'Hawaii', 'greek-isles': 'Greek Isles',
    'norwegian-fjords': 'Norwegian Fjords', 'panama-canal': 'Panama Canal',
    transatlantic: 'Transatlantic', 'canada-new-england': 'Canada & New England',
  };
  const BLURB = {
    caribbean: 'Warm beaches and easy island-hopping—the classic crowd-pleaser.',
    bahamas: 'Quick, sunny getaways and private-island beach days.',
    mediterranean: 'Iconic cities, history, and cuisine across Italy, Spain, and Greece.',
    alaska: 'Glaciers, whales, and jaw-dropping scenery.',
    mexico: 'Cabo and Puerto Vallarta on easy West Coast round-trips.',
    europe: 'World-class cities by sea, from the Baltic to the Med.',
    hawaii: 'Island-hop the Hawaiian islands in paradise.',
    'greek-isles': 'Santorini, Mykonos, and ancient ports.',
    'norwegian-fjords': 'Dramatic fjords, waterfalls, and cliffside villages.',
    'panama-canal': 'A bucket-list transit of an engineering marvel.',
    transatlantic: 'Relaxed crossings with great value.',
    'canada-new-england': 'Fall foliage, lighthouses, and historic ports.',
  };

  const QUESTIONS = [
    { q: 'Who\'s traveling?', options: [
      { t: 'Family with kids', w: { caribbean: 2, bahamas: 2, mexico: 1, alaska: 1 } },
      { t: 'A couple', w: { mediterranean: 2, 'greek-isles': 1, hawaii: 1, caribbean: 1 } },
      { t: 'Friends group', w: { caribbean: 2, bahamas: 1, mexico: 1 } },
      { t: 'Solo', w: { mediterranean: 1, europe: 1, alaska: 1 } },
      { t: 'Multi-generational', w: { caribbean: 2, alaska: 1, mediterranean: 1 } },
    ] },
    { q: 'What are you most in the mood for?', options: [
      { t: 'Beaches & relaxing', w: { caribbean: 3, bahamas: 2, hawaii: 2, mexico: 1 } },
      { t: 'Adventure & scenery', w: { alaska: 3, 'norwegian-fjords': 3, 'panama-canal': 1 } },
      { t: 'Culture & history', w: { mediterranean: 3, 'greek-isles': 2, europe: 2 } },
      { t: 'Fun & nightlife', w: { caribbean: 2, mexico: 2, bahamas: 1 } },
      { t: 'Luxury & fine dining', w: { mediterranean: 2, 'greek-isles': 1, hawaii: 1, europe: 1 } },
    ] },
    { q: 'How long do you want to be away?', options: [
      { t: 'A weekend (2-5 nights)', w: { bahamas: 2, caribbean: 1, mexico: 1 } },
      { t: 'About a week (6-9 nights)', w: { caribbean: 1, alaska: 1, mediterranean: 1, mexico: 1 } },
      { t: 'Longer (10+ nights)', w: { mediterranean: 2, europe: 2, 'panama-canal': 2, transatlantic: 2, hawaii: 1 } },
      { t: 'I\'m flexible', w: {} },
    ] },
    { q: 'When do you want to sail?', options: [
      { t: 'Summer', w: { alaska: 2, 'norwegian-fjords': 2, europe: 1, mediterranean: 1, 'canada-new-england': 1 } },
      { t: 'Winter', w: { caribbean: 2, bahamas: 1, mexico: 1, hawaii: 1 } },
      { t: 'Spring or fall', w: { mediterranean: 1, 'greek-isles': 1, 'canada-new-england': 1 } },
      { t: 'I\'m flexible', w: {} },
    ] },
  ];

  const scores = {};
  let step = 0;
  const quiz = document.getElementById('quiz');
  const bar = document.getElementById('progressBar');

  function setProgress(done, total) { bar.style.width = `${Math.round((done / total) * 100)}%`; }

  function renderQuestion() {
    const item = QUESTIONS[step];
    setProgress(step, QUESTIONS.length);
    quiz.innerHTML = `
      <div class="quiz-step">
        <div class="quiz-count">Question ${step + 1} of ${QUESTIONS.length}</div>
        <h2 class="quiz-q">${esc(item.q)}</h2>
        <div class="quiz-options">
          ${item.options.map((o, i) => `<button type="button" class="quiz-option" data-i="${i}">${esc(o.t)}</button>`).join('')}
        </div>
        ${step > 0 ? `<button type="button" class="quiz-back" id="quizBack">&larr; Back</button>` : ''}
      </div>`;
    quiz.querySelectorAll('.quiz-option').forEach((b) =>
      b.addEventListener('click', () => choose(item.options[parseInt(b.getAttribute('data-i'), 10)])));
    const back = document.getElementById('quizBack');
    if (back) back.addEventListener('click', () => { step = Math.max(0, step - 1); renderQuestion(); });
  }

  function choose(opt) {
    for (const [k, v] of Object.entries(opt.w || {})) scores[k] = (scores[k] || 0) + v;
    step += 1;
    if (step < QUESTIONS.length) renderQuestion();
    else results();
  }

  function results() {
    setProgress(QUESTIONS.length, QUESTIONS.length);
    const ranked = Object.keys(DEST)
      .map((slug) => ({ slug, score: scores[slug] || 0 }))
      .sort((a, b) => b.score - a.score);
    const top = (ranked[0].score > 0 ? ranked.filter((r) => r.score > 0) : ranked).slice(0, 3);
    quiz.innerHTML = `
      <div class="quiz-results">
        <h2 class="quiz-q">Your top cruise matches</h2>
        <p class="sub" style="margin:0 0 16px;">Based on your answers, these destinations fit you best. Explore them or get personalized quotes from trusted advisors.</p>
        <div class="quiz-recs">
          ${top.map((r) => `<a class="quiz-rec" href="/cruises/destination/${r.slug}">
            <div class="quiz-rec-name">${esc(DEST[r.slug])}</div>
            <div class="quiz-rec-blurb">${esc(BLURB[r.slug] || '')}</div>
            <span class="quiz-rec-cta">View ${esc(DEST[r.slug])} cruises &rarr;</span>
          </a>`).join('')}
        </div>
        <div class="cta-row" style="margin-top:22px;">
          <a href="/signup" class="btn btn-primary btn-lg">Get personalized quotes</a>
          <a href="/app" class="btn btn-ghost btn-lg">Browse all sailings</a>
        </div>
        <button type="button" class="quiz-back" id="quizRestart" style="margin-top:16px;">&larr; Start over</button>
      </div>`;
    const restart = document.getElementById('quizRestart');
    if (restart) restart.addEventListener('click', () => { step = 0; for (const k of Object.keys(scores)) delete scores[k]; renderQuestion(); });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  renderQuestion();
})();
