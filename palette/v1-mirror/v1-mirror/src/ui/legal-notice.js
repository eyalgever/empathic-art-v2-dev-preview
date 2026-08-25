/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LEGAL NOTICE MODULE
 * ─────────────────────────────────────────────────────────────────────────
 * Copyright & IP notice for pre-deal protection during Boundless negotiations.
 *
 * Renders:
 *   1. A small corner mark "© Eyal Gever 2026 · Legal" on every screen
 *      EXCEPT the landing ("How are you feeling right now?") screen.
 *   2. A modal with the full legal text when the mark is clicked.
 *
 * The visibility of the corner mark is driven by body[data-screen]: it
 * is hidden while data-screen="before" and revealed on every other screen.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const LEGAL_HTML = `
<article class="ea-legal__doc" role="document">
  <header class="ea-legal__hero">
    <h1 class="ea-legal__title">Empathic Art</h1>
    <p class="ea-legal__eyebrow">Copyright and Intellectual Property Notice</p>
    <p class="ea-legal__c">&copy; 2026 Eyal Gever. All rights reserved.</p>
  </header>

  <section class="ea-legal__section">
    <p>
      This work, <strong>&ldquo;Empathic Art&rdquo;</strong>, including
      the underlying concept, generative fluid engine,
      emotion&#8209;to&#8209;image mapping, particle system, visual language,
      sound composition, interaction design, textual content, source code, and
      all associated pre&#8209;existing and newly created intellectual property
      (collectively, the <strong>&ldquo;Work&rdquo;</strong>), is the
      sole and exclusive property of <strong>Eyal Gever</strong> (the
      <strong>&ldquo;Artist&rdquo;</strong>).
    </p>
    <p>
      The Work embodies proprietary methods and know&#8209;how developed by
      the Artist over many years, including technology described in the
      Artist&rsquo;s issued patents and unregistered trade secrets.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>Purpose of this preview</h2>
    <p>
      This preview has been made available to <strong>Boundless</strong> and
      its representatives (&ldquo;Boundless&rdquo;) for the following
      purposes only:
    </p>
    <ol>
      <li>good&#8209;faith negotiation of a written partnership license
        agreement between the Artist and Boundless (the
        <strong>&ldquo;Partnership Agreement&rdquo;</strong>);</li>
      <li><strong>internal integration work</strong>, permitted from
        the date of this preview through the parties&rsquo; target milestone
        in <strong>mid&#8209;September 2026</strong>, allowing
        Boundless engineering, design, and product teams to begin technical
        integration of the Work into Boundless&rsquo;s platform ahead of a
        signed Partnership Agreement; and</li>
      <li><strong>limited focus&#8209;group testing and investor
        demonstrations</strong>, permitted from mid&#8209;September
        2026 onward, solely under the conditions set out below.</li>
    </ol>
  </section>

  <section class="ea-legal__section">
    <h2>Integration, focus&#8209;group testing, and investor demonstrations:
      permitted, but not public release</h2>
    <p>
      Boundless may, <strong>at its own risk and expense</strong>, undertake
      the following activities during the negotiation period:
    </p>
    <ul>
      <li><strong>Internal integration work</strong>, in
        Boundless&rsquo;s internal development, testing, and staging
        environments, by personnel bound by written confidentiality
        obligations to Boundless;</li>
      <li><strong>Focus&#8209;group testing</strong> (from mid&#8209;September
        2026), with participants under written non&#8209;disclosure
        obligations, in closed, non&#8209;public settings;</li>
      <li><strong>Investor demonstrations</strong> (from mid&#8209;September
        2026), to prospective and existing investors under written
        non&#8209;disclosure obligations, in closed, non&#8209;public
        settings.</li>
    </ul>
    <p>
      All such activities are permitted <strong>only</strong> on the
      following strict conditions:
    </p>
    <ul>
      <li><strong>no public release, commercial launch, marketing,
        promotional campaign, press disclosure, social media publication,
        third&#8209;party distribution, or general availability</strong> of
        the Work, or of any Boundless product or feature
        incorporating the Work, is permitted without the
        Artist&rsquo;s <strong>prior written consent</strong> and a
        <strong>duly executed Partnership Agreement</strong>;</li>
      <li>every participant, focus&#8209;group member, investor, and
        representative viewing the Work must be informed that the Work is
        the copyrighted property of the Artist, shown under confidentiality,
        and shown pursuant to an ongoing partnership negotiation;</li>
      <li>Boundless acknowledges that all such activities are undertaken
        <strong>at its sole risk</strong>, and that if the parties do not
        conclude a Partnership Agreement, or if the Artist revokes permission
        under the section below, Boundless shall have no claim against the
        Artist for any cost, effort, time, opportunity, or investor
        communication expended, and shall promptly comply with the removal
        obligations set out below.</li>
    </ul>
  </section>

  <section class="ea-legal__section">
    <h2>Soft launch: by separate written permission only</h2>
    <p>
      A time&#8209;limited soft launch, for the purposes of testing,
      quality assurance, and limited user feedback, may be permitted
      <strong>only</strong> pursuant to a separate written soft&#8209;launch
      permission signed by the Artist, specifying scope, duration, audience,
      geography, and any conditions. No soft launch is permitted absent such
      express written permission. Any soft&#8209;launch permission is
      revocable in the Artist&rsquo;s sole discretion and does not
      constitute, and shall not be construed as, a Partnership Agreement or
      a license for public release.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>Duration of these permissions</h2>
    <p>
      To keep the arrangement clean for both parties, the permissions
      described in this notice apply through <strong>31 March 2027</strong>.
      If a signed Partnership Agreement is in place before that date, its
      terms take over and this notice is superseded to the extent the
      Partnership Agreement covers the same subject matter. If a signed
      Partnership Agreement is not in place by that date, the parties will
      confer in good faith to extend, renew, or wind down the current
      arrangement. This is a default backstop, intended to keep the
      partnership tidy, not a deadline on the deal itself.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>The Artist&rsquo;s right to revoke, at any time, in sole discretion</h2>
    <p>
      Notwithstanding anything to the contrary in this notice, the Artist
      may <strong>revoke</strong> the permissions granted above <strong>at
      any time, for any reason or no reason, in the Artist&rsquo;s sole and
      absolute discretion</strong>, by written notice to Boundless (including
      by email to the address below).
    </p>
    <p>Upon revocation, Boundless shall <strong>immediately</strong>:</p>
    <ol>
      <li>cease all use, integration, testing, and demonstration of the
        Work;</li>
      <li>remove the Work from any Boundless product, environment,
        repository, build, focus&#8209;group session, and investor
        communication;</li>
      <li>delete or return all copies (including source materials,
        documentation, integrations, and derivatives);</li>
      <li>issue a written notice to any focus&#8209;group participant or
        investor previously shown the Work confirming that all further use
        has ceased; and</li>
      <li>provide the Artist with written confirmation of such removal and
        deletion, signed by an authorized officer of Boundless.</li>
    </ol>
    <p>
      The Artist&rsquo;s right to revoke is <strong>absolute</strong> and is
      defeated only by the prior execution of a mutually agreed and signed
      Partnership Agreement expressly superseding this notice.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>Perpetual and irrevocable attribution: the Artist&rsquo;s
      credit</h2>
    <p>
      Wherever the Work, or any part, integration, adaptation, or
      derivative thereof, is displayed, demonstrated, screened,
      presented, distributed, or made available (whether internally, to
      focus groups, to investors, in press or marketing materials, or, upon
      a signed Partnership Agreement, publicly), Boundless shall provide the
      following credit, clearly, legibly, and unobscured:
    </p>
    <blockquote class="ea-legal__credit">
      Empathic Art, created by Eyal Gever, in partnership with
      Boundless.
    </blockquote>
    <p>This attribution obligation:</p>
    <ul>
      <li>applies to <strong>every</strong> view, screen, panel, module,
        integration, video, still image, documentation page, marketing
        asset, press release, investor deck, focus&#8209;group session, and
        any other medium in which the Work appears;</li>
      <li>names <strong>Eyal Gever</strong> as the sole <strong>creator and
        artist</strong> of the Work; Boundless may be named as
        <strong>partner</strong> or <strong>collaborator</strong>, but not
        as author, creator, artist, or co&#8209;artist;</li>
      <li>is <strong>perpetual and irrevocable</strong>, and
        <strong>survives</strong> the execution, expiration, or termination
        of any Partnership Agreement or other contract between the
        parties;</li>
      <li>cannot be waived, removed, reduced, or altered by any conduct,
        custom of dealing, or subsequent agreement other than an express
        written amendment signed by the Artist.</li>
    </ul>
    <p>
      This obligation is in addition to, and does not limit, the
      Artist&rsquo;s moral rights set out below.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>Rights strictly reserved: no license granted beyond the
      above</h2>
    <p>
      Except for the narrow permissions expressly stated above (internal
      integration, closed focus&#8209;group testing, closed investor
      demonstrations), access to this preview does <strong>not</strong>
      grant Boundless, or any third party, any license, sublicense, right,
      title, or interest of any kind in or to the Work, whether express,
      implied, by estoppel, or otherwise. In particular, and without
      limitation, nothing here grants any right to:
    </p>
    <ul>
      <li>publicly copy, reproduce, distribute, publish, or display the
        Work;</li>
      <li>launch, release, or make generally available any product or
        feature incorporating the Work;</li>
      <li>modify or adapt the Work outside the scope of permitted
        integration, or create derivative works for public use;</li>
      <li>reverse engineer, decompile, or extract source code, algorithms,
        models, weights, or data for any purpose beyond the permitted
        activities above;</li>
      <li>use the Work for any commercial, promotional, marketing,
        fundraising (other than the closed investor demonstrations
        permitted above), training, or public&#8209;facing purpose;</li>
      <li>use the name, likeness, biography, or brand of the Artist beyond
        the perpetual attribution required above.</li>
    </ul>
    <p>All rights not expressly granted are <strong>reserved</strong> to the
      Artist.</p>
  </section>

  <section class="ea-legal__section">
    <h2>Contingent nature of any public use or commercial exploitation</h2>
    <p>
      Any public use, commercial launch, general availability, release,
      distribution, or ongoing use of the Work by Boundless is
      <strong>strictly contingent</strong> upon the execution of a mutually
      acceptable Partnership Agreement, signed in writing by both parties,
      defining scope, term, territory, exclusivity, credit, fees, and
      revenue share.
    </p>
    <p>Until such Partnership Agreement is signed:</p>
    <ol>
      <li>All ownership of the Work, including any prior, current, or
        future versions, revisions, iterations, prototypes, demonstrations,
        integrations, and any derivative or preparatory materials,
        remains exclusively with the Artist;</li>
      <li>No rights transfer by delivery, demonstration, review, discussion,
        evaluation, integration, testing, or investor communication involving
        the Work;</li>
      <li>No conduct, communication, custom of dealing, or course of
        performance shall create an implied license, waiver, or transfer of
        any right.</li>
    </ol>
  </section>

  <section class="ea-legal__section">
    <h2>Moral rights</h2>
    <p>
      The Artist asserts his <strong>moral rights</strong> under the Israeli
      Copyright Act, 2007 (&sect;&sect;&nbsp;45&ndash;46), the Berne
      Convention (Art.&nbsp;6bis), the U.S. Visual Artists Rights Act
      (17&nbsp;U.S.C. &sect;&nbsp;106A), and equivalent laws worldwide,
      including the right of <strong>attribution</strong> (to be
      identified as the author of the Work in a manner suitable in the
      circumstances) and the right of <strong>integrity</strong> (to prevent
      any distortion, mutilation, modification, or derogatory treatment of
      the Work that would be prejudicial to the Artist&rsquo;s honor or
      reputation). These rights are personal, non&#8209;transferable, and
      preserved in full, in addition to the perpetual contractual
      attribution obligation above.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>Cooperative review</h2>
    <p>
      For quality, attribution, and continuity purposes, on reasonable
      notice the Artist may ask to review any Boundless integrated build,
      focus&#8209;group configuration, or investor&#8209;demonstration setup
      that incorporates the Work. This is a normal step in creative
      partnerships and is expected to be handled cooperatively, without
      formality, in the spirit of the partnership.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>Confidentiality</h2>
    <p>
      This preview and its contents are <strong>confidential</strong> and
      are shared on the understanding that Boundless and its representatives
      shall not disclose, publish, share, screenshot, record, or reproduce
      the Work, in whole or in part, outside the individuals
      directly involved in evaluating the Partnership Agreement, performing
      the permitted integration, or participating in the permitted
      focus&#8209;group or investor sessions under written
      non&#8209;disclosure obligations, without the Artist&rsquo;s prior
      written consent.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>Boundless materials: ownership acknowledgement</h2>
    <p>
      Any <strong>Boundless materials</strong> that appear in, or are played,
      displayed, or otherwise incorporated within, the Work, including,
      without limitation, <strong>Boundless screens, interface elements,
      product imagery, brand assets, logos, names, marks, music, audio,
      sound&#8209;journeys, recordings, and any related creative or technical
      content</strong> (collectively, the <strong>&ldquo;Boundless
      Materials&rdquo;</strong>), are and shall remain the sole and
      exclusive property of <strong>Boundless</strong>.
    </p>
    <p>
      Nothing in this notice, and no aspect of the Work&rsquo;s use,
      demonstration, integration, or distribution, shall be construed as
      transferring to the Artist any right, title, or interest in or to the
      Boundless Materials. The Boundless Materials are used within the Work
      solely under permission granted by Boundless for the purposes of this
      partnership preview, and any broader or continuing use of the Boundless
      Materials shall be governed by the Partnership Agreement or a separate
      written license from Boundless.
    </p>
    <p>
      The Artist&rsquo;s ownership of the Work as set out above relates to
      the Artist&rsquo;s own contributions and pre&#8209;existing intellectual
      property, and does <strong>not</strong> extend to the Boundless
      Materials.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>Trademarks</h2>
    <p>
      &ldquo;Empathic Art,&rdquo; the Empathic Art visual identity, and all
      associated names and marks are trademarks of the Artist.
      &ldquo;Boundless,&rdquo; the Boundless name, logo, and associated marks
      are trademarks of Boundless and are used here with permission solely
      for identification within this partnership preview. All other
      third&#8209;party names and marks are the property of their respective
      owners.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>No partnership implied</h2>
    <p>
      Nothing in this preview shall be deemed to create any partnership,
      joint venture, agency, employment, or fiduciary relationship between
      the Artist and Boundless. The parties are, and shall remain,
      independent until and unless a Partnership Agreement expressly
      provides otherwise.
    </p>
  </section>

  <section class="ea-legal__section">
    <h2>Governing law</h2>
    <p>
      This notice is governed by the laws of the <strong>State of
      Israel</strong>, without regard to its conflict&#8209;of&#8209;laws
      principles. Any dispute arising out of or relating to this notice or
      the Work shall be subject to the exclusive jurisdiction of the
      competent courts of Tel&nbsp;Aviv&nbsp;&ndash;&nbsp;Jaffa, Israel.
    </p>
  </section>

  <section class="ea-legal__section ea-legal__section--contact">
    <h2>Contact</h2>
    <p>
      <strong>Eyal Gever</strong>, Tel&nbsp;Aviv, Israel<br />
      <a href="mailto:eyalgever@gmail.com">eyalgever@gmail.com</a>
    </p>
  </section>

  <footer class="ea-legal__foot">
    <p>
      This notice is provided for the protection of the Artist during
      good&#8209;faith negotiation with Boundless. It is not a substitute
      for a signed Partnership Agreement, which the parties intend to
      conclude in parallel with the integration and demonstration work
      described above.
    </p>
  </footer>
</article>
`.trim();

/**
 * Attach the corner mark + modal. Idempotent, safe to call once at boot.
 */
export function initLegalNotice() {
  if (document.getElementById('ea-legal-mark')) return;

  // ─── Corner mark ─────────────────────────────────────────────────────
  const mark = document.createElement('button');
  mark.id = 'ea-legal-mark';
  mark.className = 'ea-legal-mark';
  mark.type = 'button';
  mark.setAttribute('aria-label',
    'Copyright and legal notice. Eyal Gever 2026');
  mark.innerHTML = `
    <span class="ea-legal-mark__c">&copy; Eyal Gever 2026</span>
    <span class="ea-legal-mark__sep" aria-hidden="true">&middot;</span>
    <span class="ea-legal-mark__link">Legal</span>
  `;
  document.body.appendChild(mark);

  // ─── Modal shell ─────────────────────────────────────────────────────
  const backdrop = document.createElement('div');
  backdrop.id = 'ea-legal-backdrop';
  backdrop.className = 'ea-legal-backdrop';
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.innerHTML = `
    <div class="ea-legal-modal" role="dialog" aria-modal="true"
         aria-labelledby="ea-legal-modal-title" tabindex="-1">
      <button class="ea-legal-modal__close" type="button"
              aria-label="Close legal notice">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <div class="ea-legal-modal__scroll">
        <div class="ea-legal-modal__body" id="ea-legal-modal-body"></div>
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);

  const modal = backdrop.querySelector('.ea-legal-modal');
  const body = backdrop.querySelector('#ea-legal-modal-body');
  const closeBtn = backdrop.querySelector('.ea-legal-modal__close');
  body.innerHTML = LEGAL_HTML;
  // The <h1> inside becomes the labelling title.
  const title = body.querySelector('.ea-legal__title');
  if (title) title.id = 'ea-legal-modal-title';

  let lastFocus = null;

  function open() {
    lastFocus = document.activeElement;
    backdrop.setAttribute('aria-hidden', 'false');
    document.body.setAttribute('data-legal-open', 'true');
    // Scroll to top of legal text on each open
    const scroller = backdrop.querySelector('.ea-legal-modal__scroll');
    if (scroller) scroller.scrollTop = 0;
    // Focus the close button so keyboard users can dismiss quickly
    requestAnimationFrame(() => closeBtn.focus());
  }

  function close() {
    backdrop.setAttribute('aria-hidden', 'true');
    document.body.removeAttribute('data-legal-open');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      lastFocus.focus();
    }
  }

  mark.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' &&
        backdrop.getAttribute('aria-hidden') === 'false') {
      close();
    }
  });

  // Expose for debugging / integration
  window.__eaLegal = { open, close };
}
