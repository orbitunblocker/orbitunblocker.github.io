(function(){if(window.location.protocol==='file:'){document.body.innerHTML='<h1 style="font-size:28px;font-weight:300;letter-spacing:1px;color:#fff">Run via localhost:8080</h1><p style="font-size:14px;color:#888;max-width:400px;text-align:center;line-height:1.5">Orbit requires a local server. Open http://localhost:8080 in your browser.</p>';throw new Error('file:// execution blocked')}})();

    const music = new Audio("https://files.catbox.moe/vgjm1c.mp3");
    music.loop = true;
    music.volume = 0.1;
    window.music = music;

    // Diagnostic boot status — tracks UV initialization chain
    window.__UV_BOOT_STATUS__ = {
      swReady: false,
      portReady: false,
      bareMuxReady: false,
      failedStage: 'none',
      _log: [],
      _update(key, val) {
        this[key] = val;
        this._log.push({ key, val, at: Date.now() });
      }
    };

    // Provide UV's BareClient with the SharedWorker path before any proxied navigation
    try {
      localStorage.setItem('bare-mux-path', '/uv/bare-mux-worker.js');
      window.__UV_BOOT_STATUS__._update('bareMuxPathSet', true);
      console.log('[BOOT] bare-mux-path set at', Date.now());
    } catch (e) {
      console.warn('[BOOT] Failed to set bare-mux-path:', e);
    }

    // ---- PORT STATE SYNC ----
    // SW is the single source of truth for port state. On every page load,
    // ask the SW for its actual port status rather than inferring locally.
    // The SW responds with a PORT_STATE_SYNC message.
    async function syncPortStateFromSW() {
      if (!('serviceWorker' in navigator)) return;
      try {
        const registration = await navigator.serviceWorker.ready;
        if (!registration.active) {
          window.__UV_BOOT_STATUS__._update('failedStage', 'sync-no-active');
          return;
        }
        const channel = new MessageChannel();
        const response = await Promise.race([
          new Promise(resolve => {
            channel.port1.onmessage = e => {
              channel.port1.close();
              resolve(e.data);
            };
            registration.active.postMessage({ type: 'SYNC_PORT_STATE', checkHealth: false }, [channel.port2]);
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('sync timeout')), 3000))
        ]);
        if (response) {
          window.__UV_BOOT_STATUS__._update('swSynced', true);
          // SW's port state is the authority — overwrite local assumptions
          if (response.portReady !== undefined) {
            window.__UV_BOOT_STATUS__._update('portReady', response.portReady);
            window.__UV_BOOT_STATUS__.portReady = response.portReady;
          }
          if (response.bareMuxReady !== undefined) {
            window.__UV_BOOT_STATUS__._update('bareMuxReady', response.bareMuxReady);
            window.__UV_BOOT_STATUS__.bareMuxReady = response.bareMuxReady;
          }
          if (response.status) {
            window.__UV_BOOT_STATUS__._update('swPortStatus', response.status);
          }
          if (response.reinitCount !== undefined) {
            window.__UV_BOOT_STATUS__._update('swReinitCount', response.reinitCount);
          }
        }
      } catch (e) {
        window.__UV_BOOT_STATUS__._update('failedStage', 'sync');
      }
    }
    window.syncPortStateFromSW = syncPortStateFromSW;

    const UV_PREFIX = '/service/';
    window.UV_PREFIX = UV_PREFIX;
    function encodeUVUrl(url) {
      if (!url || url === 'about:blank') return url;
      try {
        return UV_PREFIX + Ultraviolet.codec.xor.encode(url);
      } catch (e) {
        console.warn('[UV] Encoding failed, falling back to direct URL', e);
        return url;
      }
    }
    window.encodeUVUrl = encodeUVUrl;

    const hoverAudio = new Audio("https://files.catbox.moe/h71sur.mp3");
    hoverAudio.preload = "auto";
    window.__voltraSfxVolume = 0.1;

    music.load();
    hoverAudio.load();

    window.playHover = function(pitch = 1) {
      const sfx = hoverAudio.cloneNode();
      sfx.volume = window.__voltraSfxVolume;
      sfx.playbackRate = pitch;
      sfx.play().catch(() => {});
    };

    const intro = document.getElementById('introScreen');
    const enterButton = document.getElementById('enterButton');

    function startExperience() {
      document.body.classList.add('on-homepage');
      music.play().catch(() => {});
      const primer = hoverAudio.cloneNode();
      primer.volume = 0;
      primer.play().catch(() => {});
      intro.classList.add('fade-out');

      // Initialize Welcome text immediately
      const heroTitle = document.querySelector('.hero h1');
      if (heroTitle) {
        heroTitle.innerHTML = `Welcome <span class="typed-word"></span><span class="typing-caret" aria-hidden="true"></span>`;
      }

      setTimeout(() => {
        intro.remove();
        typeCyclingText();
        // Reveal hero logo and clock with fade-and-rise
        const heroSection = document.getElementById('heroSection');
        resetHeroSearchBar({ entrance: true });
        if (heroSection) heroSection.classList.add('reveal');
        const infoIcon = document.querySelector('.hero-info-icon');
        if (infoIcon) infoIcon.style.opacity = '1';
        const dock = document.querySelector('.bottom-dock');
        if (dock) dock.classList.add('reveal');
      }, 500);
    }

    if (enterButton) {
      enterButton.addEventListener('click', startExperience);
      enterButton.addEventListener('touchstart', startExperience);
    }

    const canvas = document.getElementById('bg');
    const ctx = canvas.getContext('2d');

    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;
    let visualMotionReduced = false;

    const particles = [];
    let cachedAccentA = '125,211,252';
    let cachedAccentB = '192,132,252';
    let aRGB = [125, 211, 252];
    let bRGB = [192, 132, 252];

    function updateParticleColors() {
      const rootStyle = getComputedStyle(document.documentElement);
      cachedAccentA = rootStyle.getPropertyValue('--accent-a').trim() || '125,211,252';
      cachedAccentB = rootStyle.getPropertyValue('--accent-b').trim() || '192,132,252';
      aRGB = cachedAccentA.split(',').map(v => parseInt(v.trim()));
      bRGB = cachedAccentB.split(',').map(v => parseInt(v.trim()));
    }

    class Particle {
      constructor(initial = false) { this.reset(initial); }
      reset(initial = false) {
        this.x = Math.random() * width;
        if (initial) {
          this.y = Math.random() * height;
        } else {
          this.y = height + Math.random() * 50;
        }
        this.radius = Math.random() * 2 + 1;
        this.baseSpeedX = (Math.random() - 0.5) * 0.1;
        this.speedY = -(Math.random() * 0.2 + 0.1);
        this.wobble = Math.random() * Math.PI * 2;
        this.wobbleSpeed = Math.random() * 0.002 + 0.001;
        this.wobbleAmplitude = Math.random() * 0.08 + 0.02;
        this.delay = initial ? 0 : Math.random() * 3000;
        this.emitted = initial;
      }
      update(time) {
        if (!this.emitted) {
          if (time > this.delay) {
            this.emitted = true;
          } else {
            return;
          }
        }
        this.wobble += this.wobbleSpeed;
        this.x += this.baseSpeedX + Math.sin(this.wobble) * this.wobbleAmplitude;
        this.y += this.speedY;
        if (this.y < -10 || this.x < 0 || this.x > width) {
          this.reset();
          this.delay = Math.random() * 2000 + 500;
          this.emitted = false;
        }
      }
      draw(time) {
        if (!this.emitted) return;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,1)`;
        ctx.fill();
      }
    }

    for (let i = 0; i < 200; i++) particles.push(new Particle(true));

    function animate() {
      ctx.clearRect(0, 0, width, height);
      const time = Date.now();
      particles.forEach(p => {
        if (!visualMotionReduced) p.update(time);
        p.draw(time);
      });
      requestAnimationFrame(animate);
    }
    animate();

    function syncLayout() {
      const nav = document.querySelector('.navbar');
      const heroTitle = document.querySelector('.hero h1');
      const heroDescription = document.querySelector('.hero p');
      const heroSearch = document.querySelector('.hero-search-stack');

      if (nav) {
        document.documentElement.style.setProperty('--nav-height', `${Math.ceil(nav.getBoundingClientRect().height)}px`);
      }

      if (heroTitle && heroSearch) {
        const titleWidth = Math.ceil(heroTitle.getBoundingClientRect().width);
        const descWidth = heroDescription ? Math.ceil(heroDescription.getBoundingClientRect().width) : 0;

        // Only compute search width once on first initialization, never recalculate
        if (!heroSearchWidthInitialized && titleWidth > 0) {
          const compact = window.innerWidth < 420;
          const initialCap = window.innerWidth - (compact ? 24 : 80);
          const expandedCap = window.innerWidth - (compact ? 12 : 40);
          const minInitial = Math.min(500, initialCap);
          const baseWidth = Math.max(titleWidth + 120, descWidth + 40, minInitial);
          const initialWidth = Math.min(Math.max(baseWidth, minInitial), initialCap);
          const expandedTarget = Math.max(initialWidth + (compact ? 48 : 150), descWidth + (compact ? 20 : 80));
          const expandedWidth = Math.min(expandedTarget, expandedCap);

          const newInitial = `${Math.round(initialWidth)}px`;
          const newExpanded = `${Math.round(Math.max(initialWidth, expandedWidth))}px`;

          heroSearch.style.setProperty('--hero-search-width', newInitial);
          heroSearch.style.setProperty('--hero-search-expanded-width', newExpanded);
          heroSearchWidthInitialized = true;
        }
      }
    }

    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
        syncLayout();
      }, 150);
    });

    window.addEventListener('load', syncLayout);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncLayout);
    }
    requestAnimationFrame(syncLayout);

    const cookieIcon = "https://outred.org/g/assets/cookie-clicker/cookie1.jpeg";
    const cookieUrl = "https://script.google.com/macros/s/AKfycbxGM35J29NkO-2LYjxWj_cA9IUaaXypkUy-LqXyLRbGTz0R6lXmAEapz1STN1jlTIRavw/exec";
    const slopeIcon = "https://blog.free-dyndns.org/assets/imgs/g/Slope.webp";
    const slopeUrl = "https://slope-game-io.github.io/games/slope/index.html";
    const basketballStarsIcon = "https://outred.org/g/assets/basketball-stars/assets/images/basketball-stars.png";
    const basketballStarsUrl = "https://script.google.com/macros/s/AKfycbxy1zNkV2rOD3Y_MXtUDPDNAMdvJ1HgBkOTnzq4e5ZW-WJkznkIoUTr1J1fmEQ_cG4b4Q/exec";
    const clusterRushIcon = "https://outred.org/g/assets/cluster-rush/splash.png";
    const clusterRushUrl = "https://script.google.com/macros/s/AKfycbw6e8fflbfydV7kom5id09nKaM6ix0hLlXHbs3XHOnxzrndUgPtHUHENrwKomI2Hpk3/exec";
    const driftHuntersIcon = "https://outred.org/g/assets/drift-hunters/drift-hunters.png";
    const driftHuntersUrl = "https://script.google.com/macros/s/AKfycbw8iHPqdVFEzquUYbNxFVAu1Tw4Nri5SWMRLdP_c7a84vCOHVG7YUWuhjSVptg1SVHr/exec";
    const duckLifeIcon = "https://outred.org/g/assets/ducklife1/ducklife.png";
    const duckLifeUrl = "https://ducklife.gitlab.io/file/";
    const minecraftIcon = "https://outred.org/g/assets/minecraft-15/splash.jpeg";
    const minecraftUrl = "https://minecrafteaglercraft.gitlab.io/go/minecraft-1.5.2/";
    const elasticManIcon = "https://outred.org/g/assets/elasticman/elasticman.jpg";
    const elasticManUrl = "https://script.google.com/macros/s/AKfycbwWOlo7-AMuejI5XKrJqrSzDvuH9X6yfNfhgX4HSL1P-i3eAY5Qi51vMdDJM13V4MXJIQ/exec";
    const fireboyWatergirlIcon = "https://imgs.crazygames.com/games/fireboy-and-watergirl-the-forest-temple/cover-1586285142530.jpg?metadata=none&quality=60&height=4906";
    const fireboyWatergirlUrl = "https://script.google.com/macros/s/AKfycbw8EVdUCzgTInevqT2h0DOxeN07fjoLrB5DowKa1TlhpqFnJ1IkViYJ7uV58-8yITGztg/exec";
    const flappyBirdIcon = "https://outred.org/g/assets/flappy-bird/assets/thumb.png";
    const flappyBirdUrl = "https://scratch.mit.edu/projects/embed/17964117/";
    const fruitNinjaIcon = "https://outred.org/g/assets/fruitninja/FruitNinjaTeaser.jpg";
    const fruitNinjaUrl = "https://classroom2111.github.io/g50/class-22/";

    const appData = [];

    const sectionData = {
      games: [
        {
          id: "minecraft",
          title: "Minecraft",
          desc: "Explore, mine, and craft in a blocky sandbox where you gather resources, build shelters, and survive the night.",
          badge: "SANDBOX",
          emoji: "⛏️",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Eaglercraft_v1_8.webp",
          url: minecraftUrl
        },
        {
          id: "fnaf-1",
          title: "Five Nights at Freddy's",
          desc: "Survive five nights as a night security guard at Freddy Fazbear's Pizza. Monitor cameras and avoid animatronic attacks.",
          badge: "HORROR",
          emoji: "🐻",
          image: "https://blog.free-dyndns.org/assets/imgs/g/FNAF_1__Scratch_.webp",
          url: "https://script.google.com/macros/s/AKfycbxJNtrKTWPCSIo9tOqq53G2xqoQCIPDTYUsVOT79Eqk8I7C5cQkGdDnj0jzlNHa7bvs3g/exec"
        },
        {
          id: "fnaf-2",
          title: "Five Nights at Freddy's 2",
          desc: "Return to Freddy Fazbear's Pizza with new animatronics and challenges. Survive the night in this horror sequel.",
          badge: "HORROR",
          emoji: "🐰",
          image: "https://blog.free-dyndns.org/assets/imgs/g/FNAF_2.webp",
          url: "https://d11jzht7mj96rr.cloudfront.net/games/2024/more2/five-nights-at-freddys-2/index-gg.html"
        },
        {
          id: "fnaf-3",
          title: "Five Nights at Freddy's 3",
          desc: "Face your fears at Fazbear's Fright, a horror attraction. Survive against a single animatronic in this tense sequel.",
          badge: "HORROR",
          emoji: "🎭",
          image: "https://blog.free-dyndns.org/assets/imgs/g/FNAF_3.webp",
          url: "https://script.google.com/macros/s/AKfycbyVdPAG4aRGh5tmBwKEZthKmaqO12GTD-h-C1Do6ICbR3ZEj5ic1aJQ2e4Im2pxcWLf/exec"
        },
        {
          id: "fnaf-4",
          title: "Five Nights at Freddy's 4",
          desc: "Experience the terror in your own bedroom. Defend yourself from nightmare animatronics in this final chapter.",
          badge: "HORROR",
          emoji: "😱",
          image: "https://blog.free-dyndns.org/assets/imgs/g/FNAF_4__Scratch_.webp",
          url: "https://turbowarp.org/453803381/embed"
        },
        {
          id: "slope",
          title: "Slope",
          desc: "Steer a neon ball down an endless 3D track, dodge obstacles, and chase your best run in this fast reflex arcade favorite.",
          badge: "ARCADE",
          emoji: "📐",
          image: slopeIcon,
          url: slopeUrl
        },
        {
          id: "cluster-rush",
          title: "Cluster Rush",
          desc: "Leap across a speeding convoy of trucks in a frantic low-poly runner where one missed jump sends you tumbling off the road.",
          badge: "RUNNER",
          emoji: "🚛",
          image: clusterRushIcon,
          url: clusterRushUrl
        },
        {
          id: "papas-burgeria",
          title: "Papa's Burgeria",
          desc: "Run your own burger restaurant! Take orders, grill patties, add toppings, and serve hungry customers in this time management classic.",
          badge: "SIMULATION",
          emoji: "🍔",
          image: "https://www.coolmathgames.com/sites/default/files/PapasBurgeria_OG-logo.jpg",
          url: "https://script.google.com/macros/s/AKfycbyyfjHc-YiNqGOngfUlkjS5Fvx2x0UYfkerogM_Y3-Z1BQTZW2K0AcegLUtVdRjo5nM/exec"
        },
        {
          id: "papas-pizzeria",
          title: "Papa's Pizzeria",
          desc: "Build the perfect pizza from dough to delivery. Manage toppings, oven timing, and customer satisfaction in this culinary challenge.",
          badge: "SIMULATION",
          emoji: "🍕",
          image: "data:image/jpeg;base64,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",
          url: "https://script.google.com/macros/s/AKfycbxN6EVQbtkjn6NUiIyJscLGTyyMyAUABzuB_kp4relIe6rr9B8eWmlnlvDsBVtiRa5pPg/exec"
        },
        {
          id: "basketball-stars",
          title: "Basketball Stars",
          desc: "Drop into fast 1v1 arcade hoops, chain flashy shots, and outplay rivals with timing, steals, and big-head streetball style.",
          badge: "SPORTS",
          emoji: "🏀",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Basketball_Stars.webp",
          url: basketballStarsUrl
        },
        {
          id: "drift-boss",
          title: "Drift Boss",
          desc: "Drift around tight corners and collect coins in this addictive arcade racing game. Master the art of drifting.",
          badge: "RACING",
          emoji: "🏎️",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Drift_Boss.webp",
          url: "https://script.google.com/macros/s/AKfycbwAOi2tPbjzeWDkigfZMIPEGubYxz2la_qjxJyydNZyjwgbqsv9mv05g7tdmLHdvdaw/exec"
        },
        {
          id: "mario-kart-64",
          title: "Mario Kart 64",
          desc: "Race against friends and AI in this classic Nintendo racing game. Use power-ups and drift to victory.",
          badge: "RACING",
          emoji: "🏁",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Mario_Kart_64.webp",
          url: "https://www.fanfreegames.com/game.php?id_juego=19439&id_dominio=2&code=9862ed4cvv18dbb18v19vv6ved61v17v&ads=1"
        },
        {
          id: "duck-life",
          title: "Duck Life",
          desc: "Train your duck in running, flying, and swimming, then enter races and grow from a rookie hatchling into a champion.",
          badge: "ADVENTURE",
          emoji: "🦆",
          image: duckLifeIcon,
          url: duckLifeUrl
        },
        {
          id: "duck-life-2",
          title: "Duck Life 2",
          desc: "Train your duck in running, swimming, flying, and climbing across new courses. Compete in tournaments and unlock abilities.",
          badge: "ADVENTURE",
          emoji: "🦆",
          image: "https://outred.org/g/assets/ducklife2/ducklife2.png",
          url: "https://script.google.com/macros/s/AKfycbxt1OfesayrpvZO0iyVbq-_DJAgydK1MtfKUflXEkxk8MUHBuV_GIo81yIQoNNiUAzbUA/exec"
        },
        {
          id: "duck-life-3",
          title: "Duck Life 3",
          desc: "Evolve your duck through generations with new skills, habitats, and challenges. Breed, train, and race to create the ultimate duck.",
          badge: "ADVENTURE",
          emoji: "🥚",
          image: "data:image/jpeg;base64,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",
          url: "https://script.google.com/macros/s/AKfycbxKC46TPtFqkQ8CyDyHSxOxthdFPI4de6mTUDZsmdXhUjxictSPiOGP0NEREVNrOH8P/exec"
        },
        {
          id: "duck-life-4",
          title: "Duck Life 4",
          desc: "Explore a vast world with your duck team. Train multiple ducks, discover new areas, and compete in the ultimate duck championships.",
          badge: "ADVENTURE",
          emoji: "🏆",
          image: "data:image/jpeg;base64,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",
          url: "https://script.google.com/macros/s/AKfycby2EtapHf3dWrR5iauSK_yeOo64MGUkkkxIbYCsQBrQN8rmxohGIAKF1U69foTGQsoj/exec"
        },
        {
          id: "cookie-clicker",
          title: "Cookie Clicker",
          desc: "Build a cookie empire one click at a time, then turn upgrades, grandmas, and wild production boosts into an endless bakery machine.",
          badge: "CLASSIC",
          emoji: "🍪",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Cookie_Clicker.webp",
          url: cookieUrl
        },
        {
          id: "super-mario-bros",
          title: "Super Mario Bros.",
          desc: "Jump through the Mushroom Kingdom, defeat Bowser, and rescue Princess Peach in this iconic platforming classic.",
          badge: "CLASSIC",
          emoji: "🍄",
          image: "https://static0.polygonimages.com/wordpress/wp-content/uploads/chorus/uploads/chorus_asset/file/22416111/smb_art.jpg?w=1600&h=900&fit=crop",
          url: "https://script.google.com/macros/s/AKfycbwOs-SsYeiN758I5eVCPGl7YW-IpawaSbapsKt3NUZwWLSpC8fZfDH7wqeQE1hGBiSZ/exec"
        },
        {
          id: "super-mario-64",
          title: "Super Mario 64",
          desc: "Explore Princess Peach's castle and jump into painting worlds. Collect Power Stars in this groundbreaking 3D platforming adventure.",
          badge: "CLASSIC",
          emoji: "⭐",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Super_Mario_64.webp",
          url: "https://script.google.com/macros/s/AKfycbyB8Cg09IyL5iA01VRMcp6GXWBsHJDyytzuovDyiHdgIUmtHuNM7x27VlBnJjYt26F-/exec"
        },
        {
          id: "elastic-man",
          title: "Elastic Man",
          desc: "Click and drag to stretch a rubbery 3D face with satisfying physics that wobble and snap back every time you let go.",
          badge: "CASUAL",
          emoji: "🎭",
          image: elasticManIcon,
          url: elasticManUrl
        },
        {
          id: "blob-opera",
          title: "Blob Opera",
          desc: "Conduct a quartet of singing blobs in harmonious melodies. Drag to control pitch and create beautiful choral arrangements.",
          badge: "MUSIC",
          emoji: "🎭",
          image: "data:image/jpeg;base64,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",
          url: "https://cilex-aeiopera.uc.r.appspot.com/#/"
        },
        {
          id: "flappy-bird",
          title: "Flappy Bird",
          desc: "Tap to stay airborne and thread a pixel bird through tight pipe gaps in this brutally simple, endlessly replayable arcade test.",
          badge: "ARCADE",
          emoji: "🐦",
          image: flappyBirdIcon,
          url: flappyBirdUrl
        },
        {
          id: "fruit-ninja",
          title: "Fruit Ninja",
          desc: "Swipe fast to slice flying fruit, chain combos, and dodge bombs in a juicy reflex arcade classic built for quick sessions.",
          badge: "ACTION",
          emoji: "🍉",
          image: fruitNinjaIcon,
          url: fruitNinjaUrl
        },
        {
          id: "drift-hunters",
          title: "Drift Hunters",
          desc: "Tune your car, hit the track, and chase perfect drifts with smoke-filled corners and upgrade-heavy street racing action.",
          badge: "RACING",
          emoji: "🏎️",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Drift_Hunters.webp",
          url: driftHuntersUrl
        },
        {
          id: "motox3m",
          title: "Moto X3M",
          desc: "Race through challenging obstacle courses on a motorcycle. Perform stunts, avoid traps, and beat the clock in this physics-based racer.",
          badge: "RACING",
          emoji: "🏍️",
          image: "https://outred.org/g/assets/motox3m/splash.jpg",
          url: "https://script.google.com/macros/s/AKfycbzv1h8PLdH7WouQ0T09hlcWifgJGTCYkrIKf1urYncfCcdm-F9sYZ4ex-U6Vp0tVHnI4g/exec"
        },
        {
          id: "retro-bowl",
          title: "Retro Bowl",
          desc: "Lead your football team to glory in this retro-style sports management game. Call plays, manage your roster, and win championships.",
          badge: "SPORTS",
          emoji: "🏈",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Retro_Bowl.webp",
          url: "https://amhooman.github.io/website/games/retrobowl/game.html"
        },
        {
          id: "ovo",
          title: "OvO",
          desc: "Slide, jump, and dash through minimalist platforming levels. Master precise movement and timing in this sleek speed-running challenge.",
          badge: "PLATFORMER",
          emoji: "🥚",
          image: "https://blog.free-dyndns.org/assets/imgs/g/OVO_Modded.webp",
          url: "https://script.google.com/macros/s/AKfycbyDZOJq86UIFlMkKfvZtA_Sv86sKooVRpwVFS2rb38TOT8ExCt3PfR1Y5UAveVuVGlQLw/exec"
        },
        {
          id: "temple-run-2",
          title: "Temple Run 2",
          desc: "Run for your life through ancient temples and cliffs. Slide, jump, and turn while being chased by demonic monkeys in this endless runner.",
          badge: "RUNNER",
          emoji: "🏃",
          image: "https://imangistudios.com/wp-content/uploads/2022/01/Games_tr2_b.png",
          url: "https://emulatoros.github.io/html5-games/games/templerun2/"
        },
        {
          id: "subway-surfers",
          title: "Subway Surfers",
          desc: "Run, jump, and surf through endless subway tracks. Dodge trains, collect coins, and unlock characters in this endless runner classic.",
          badge: "RUNNER",
          emoji: "🏃",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Subway_Surfers.webp",
          url: "https://gertdoro.github.io/3hg7dj3bnc82/index.html"
        },
        {
          id: "run-3",
          title: "Run 3",
          desc: "Run through endless tunnels in space, switching gravity and navigating gaps. A unique endless runner with mind-bending level design.",
          badge: "RUNNER",
          emoji: "🌌",
          image: "data:image/jpeg;base64,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",
          url: "https://lekug.github.io/tn6pS9dCf37xAhkJv/"
        },
        {
          id: "1v1-lol",
          title: "1v1.lol",
          desc: "Build, shoot, and outplay opponents in fast 1v1 build battles. Master editing, aim, and strategy in this competitive shooter.",
          badge: "SHOOTER",
          emoji: "🔫",
          image: "https://blog.free-dyndns.org/assets/imgs/g/1v1_LOL.webp",
          url: "https://googleusercontent.b-cdn.net/one/oneup.html"
        },
        {
          id: "superhot",
          title: "Superhot",
          desc: "Time moves only when you move in this innovative shooter. Plan your every step and unleash stylish combat in slow-motion mayhem.",
          badge: "SHOOTER",
          emoji: "🔥",
          image: "https://assets.nintendo.com/image/upload/c_fill,w_1200/q_auto:best/f_auto/dpr_2.0/store/software/switch/70010000020726/18a6f0955e118ae5589de02e64719e182133f5de71cc0017e93145cd938d212e",
          url: "https://mgalternative.github.io/d4b259d1-cd08-44ae-b2d2-fc3981b58fca/content/m.igroblox.ru/ngm/super-khot/index.html"
        },
        {
          id: "rooftop-snipers",
          title: "Rooftop Snipers",
          desc: "Duel on narrow rooftops in this physics-based sniper game. Knock your opponent off the edge with precise shots and environmental traps.",
          badge: "SHOOTER",
          emoji: "🎯",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Rooftop_Snipers.webp",
          url: "https://script.google.com/macros/s/AKfycbyoVKqSi44yCkcl01rp17c7Dluj_4Q9P5kSsqGcf02xgBTx_mT6jik17o2mhkGgd9Yj/exec"
        },
        {
          id: "fireboy-and-watergirl",
          title: "Fireboy and Watergirl",
          desc: "Guide fire and water through temple levels, switch between heroes, and solve co-op puzzles using each one's unique powers.",
          badge: "PUZZLE",
          emoji: "🔥",
          image: fireboyWatergirlIcon,
          url: fireboyWatergirlUrl
        },
        {
          id: "assessment-examination",
          title: "Assessment Examination",
          desc: "Navigate through a surreal and unsettling examination room. Solve puzzles and uncover the mysteries hidden within.",
          badge: "PUZZLE",
          emoji: "📝",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Assessment_Examination.webp",
          url: "https://kdata1.com/2022/07/assessment-examination/"
        },
        {
          id: "paper-io-2",
          title: "Paper.io 2",
          desc: "Expand your territory by drawing trails across the map. Outmaneuver opponents and claim the largest area in this strategic conquest game.",
          badge: "STRATEGY",
          emoji: "📄",
          image: "https://outred.org/g/assets/paperio2/images/icon512.png",
          url: "https://script.google.com/macros/s/AKfycbwNxCzUuQVmLRWTwYK2D4yTqpWg2O-qge8BwCkxhLmqWd1DtXynwJXPEDClPt7ERZr-/exec"
        },
        {
          id: "plants-vs-zombies",
          title: "Plants vs Zombies",
          desc: "Defend your lawn with an arsenal of plants against waves of zombies. Strategic tower defense meets quirky humor in this classic.",
          badge: "STRATEGY",
          emoji: "🌻",
          image: "https://m.media-amazon.com/images/I/610yCrA+ZPL._AC_UF350,350_QL80_.jpg",
          url: "https://script.google.com/macros/s/AKfycby_ln3ql4aO56lxfeLUH_UziAcZvRzETmL9zqekK0neuz5OHISrr6getE8_-or9E_Tj/exec"
        },
        {
          id: "snowball-io",
          title: "Snowball.io",
          desc: "Roll snowballs to grow larger and knock opponents off the arena. A simple yet addictive multiplayer battle game.",
          badge: "MULTIPLAYER",
          emoji: "⛄",
          image: "https://outred.org/g/assets/snowbattle/img/logo.png",
          url: "https://script.google.com/macros/s/AKfycbxa3OjBw8KWer3YhEXl1wxoe1uQKNo-wgGuqPO3NTndX566TTs10-ioXopEPitTvE-B/exec"
        },
        {
          id: "lolbeans",
          title: "Lolbeans.io",
          desc: "Race through chaotic obstacle courses in this Fall Guys-style multiplayer game. Dodge obstacles, compete in rounds, and be the last bean standing.",
          badge: "MULTIPLAYER",
          emoji: "🫘",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Stumble_Guys.webp",
          url: "https://lolbeans.io"
        },
        {
          id: "78-hour-rain",
          title: "78 Hour Rain",
          desc: "Survive through 78 hours of relentless rain in this atmospheric survival game. Manage resources and endure the elements.",
          badge: "SURVIVAL",
          emoji: "🌧️",
          image: "https://blog.free-dyndns.org/assets/imgs/g/78_Hour_Rain.webp",
          url: "https://update.www.wwwdev.v2202411214484298543.megasrv.de/gamefiles/78hourrain/"
        },
        {
          id: "buckshot-roulette",
          title: "Buckshot Roulette",
          desc: "Play a deadly game of chance with a shotgun. Face off against the dealer in this tense and atmospheric horror game.",
          badge: "HORROR",
          emoji: "🔫",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Buckshot_Roulette.webp",
          url: "https://script.google.com/macros/s/AKfycbzDoljfcUtdBiC1zHYSF0w4ABxRDp20jNPHRcbXg9zr7m_ak24LFHAcmEOUWjxGnXgu_w/exec"
        },
        {
          id: "burger-frights",
          title: "Burger & Frights",
          desc: "Navigate a spooky world as a burger on the run. Dodge terrifying creatures and survive the night in this horror adventure.",
          badge: "HORROR",
          emoji: "🍔",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Burger___Frights.webp",
          url: "https://unblocked-games-g.gitlab.io/burgerandfrights/"
        },
        {
          id: "darkness-in-spaceship",
          title: "Darkness in Spaceship",
          desc: "Explore a dark and mysterious spaceship. Uncover the secrets lurking in the shadows in this sci-fi horror adventure.",
          badge: "HORROR",
          emoji: "🚀",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Darkness_in_Spaceship.webp",
          url: "https://web.i-gamer.net/flash9/3.2070_DarknessInSpaceship/index.html"
        },
        {
          id: "baldis-basics",
          title: "Baldi's Basics",
          desc: "Navigate a surreal schoolhouse while solving math problems and evading Baldi. A horror-education mashup with unsettling charm.",
          badge: "HORROR",
          emoji: "📏",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Baldis_Basics.webp",
          url: "data:text/html;base64,PCFET0NUWVBFIGh0bWw+DQo8aHRtbD4NCjxoZWFkPg0KPGxpbmsgcmVsPSJzdHlsZXNoZWV0IiBocmVmPSJodHRwczovL3Jhd2Nkbi5naXRoYWNrLmNvbS91c2VybmFtZWd0aC9kaWFtb25kbWluZS9jZTNmMDE0ZDc0NjhkMjZlNTc4YTIzZGU3NzczZGRlYjRmNDBiMjRmL2dzL2dzZmlsZXMvYmFzaWNzL1RlbXBsYXRlRGF0YS9zdHlsZS5jc3MiPg0KPC9oZWFkPg0KPGJvZHk+DQo8c2NyaXB0IHNyYz0iaHR0cHM6Ly9yYXdjZG4uZ2l0aGFjay5jb20vdXNlcm5hbWVndGgvZGlhbW9uZG1pbmUvY2UzZjAxNGQ3NDY4ZDI2ZTU3OGEyM2RlNzc3M2RkZWI0ZjQwYjI0Zi9ncy9nc2ZpbGVzL2Jhc2ljcy9UZW1wbGF0ZURhdGEvVW5pdHlQcm9ncmVzcy5qcyI+PC9zY3JpcHQ+DQogICAgPHNjcmlwdCBzcmM9Imh0dHBzOi8vcmF3Y2RuLmdpdGhhY2suY29tL3VzZXJuYW1lZ3RoL2RpYW1vbmRtaW5lL2NlM2YwMTRkNzQ2OGQyNmU1NzhhMjNkZTc3NzNkZGViNGY0MGIyNGYvZ3MvZ3NmaWxlcy9iYXNpY3MvYmFsZGkuanMiPjwvc2NyaXB0Pg0KICAgIDxzY3JpcHQ+DQogICAgICB2YXIgZ2FtZUluc3RhbmNlID0gVW5pdHlMb2FkZXIuaW5zdGFudGlhdGUoImdhbWVDb250YWluZXIiLCAiaHR0cHM6Ly9yYXdjZG4uZ2l0aGFjay5jb20vdXNlcm5hbWVndGgvZGlhbW9uZG1pbmUvY2UzZjAxNGQ3NDY4ZDI2ZTU3OGEyM2RlNzc3M2RkZWI0ZjQwYjI0Zi9ncy9nc2ZpbGVzL2Jhc2ljcy9iYWxkaS5qc29uIiwge29uUHJvZ3Jlc3M6IFVuaXR5UHJvZ3Jlc3MsTW9kdWxlOntvblJ1bnRpbWVJbml0aWFsaXplZDogZnVuY3Rpb24oKSB7VW5pdHlQcm9ncmVzcyhnYW1lSW5zdGFuY2UsICJjb21wbGV0ZSIpfX19KTsNCiAgICA8L3NjcmlwdD4NCgk8c2NyaXB0IHNyYz0iaHR0cHM6Ly9jZG4uanNkZWxpdnIubmV0L2doL3N0Mzkvc2RrQG1haW4vYXBpLmpzIj48L3NjcmlwdD4NCiAgICA8ZGl2IGNsYXNzPSJ3ZWJnbC1jb250ZW50Ij4NCiAgICAgICAgPGRpdiBpZD0iZ2FtZUNvbnRhaW5lciIgc3R5bGU9IndpZHRoOiAxMDB2dzsgaGVpZ2h0OiAxMDB2aCI+PC9kaXY+DQogICAgICAgIDwvZGl2Pg0KPC9ib2R5Pg0KPC9odG1sPg=="
        },
        {
          id: "backrooms",
          title: "Backrooms",
          desc: "Explore the endless liminal maze of yellow rooms. Avoid entities, find supplies, and uncover the mysteries of this eerie space.",
          badge: "HORROR",
          emoji: "🚪",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Backrooms.webp",
          url: "https://gamecollections.me/game/3kh0-assets-main/backrooms/"
        },
        {
          id: "granny",
          title: "Granny",
          desc: "Escape from a terrifying house while being hunted by Granny. Solve puzzles and find keys to get out alive.",
          badge: "HORROR",
          emoji: "👵",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Granny.webp",
          url: "https://grannyfree.io/play/granny/"
        },
        {
          id: "happy-wheels",
          title: "Happy Wheels",
          desc: "Race through obstacle courses with ragdoll physics. Navigate deadly traps and reach the finish line in this chaotic game.",
          badge: "ACTION",
          emoji: "🚴",
          image: "https://blog.free-dyndns.org/assets/imgs/g/Happy_Wheels.webp",
          url: "https://script.google.com/macros/s/AKfycbyfMPVIGx6dJPrYKeE9e4Erj949-dH28pWVRjdV1vgnoylpBV8af03JNLoz2MwAIBLECg/exec"
        },
        {
          id: "slow-roads",
          title: "Slow Roads",
          desc: "Drive endless roads through serene landscapes. A relaxing driving experience with no timers, no score, just open roads and a calm journey.",
          badge: "DRIVING",
          emoji: "🚗",
          image: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT76btQTGOYcbq_of2VE8gwxwY8xt3xaGy9Mw&s",
          url: "https://script.google.com/macros/s/AKfycbzqDA2SnuVZ3DRelxxbUxSV9Z1RJz_gQfDRx06WUpgppWgrdDEErtZ1Lev9O6j2w9ioBQ/exec"
        },
        {
          id: "papers-please",
          title: "Papers, Please",
          desc: "Man the immigration checkpoint in a dystopian border. Inspect documents, spot forgeries, and make tough decisions to support your family.",
          badge: "SIMULATION",
          emoji: "🛂",
          image: "https://miro.medium.com/1*Wto643yG6HgprZfAafHPdQ.jpeg",
          url: "https://www.archive.play-games.com/games/ruffle/?swf=archive/5/PapersPlease2.swf&params=&name=Papers%20Please"
        },
        {
          id: "half-life",
          title: "Half-Life",
          desc: "Fight through the Black Mesa Research Facility after a catastrophic resonance cascade. Solve puzzles and survive alien encounters in this legendary FPS.",
          badge: "SHOOTER",
          emoji: "🔬",
          image: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/70/capsule_616x353.jpg?t=1745368462",
          url: "https://pixelsuft.github.io/hl/"
        },
        {
          id: "sort-the-court",
          title: "Sort the Court!",
          desc: "Advise a quirky king by swiping yes or no on an endless stream of visitor requests. Every choice shapes your kingdom's fate.",
          badge: "SIMULATION",
          emoji: "👑",
          image: "https://www.gamebrew.org/thumb.php?f=SorttheCourtVita.png&width=640",
          url: "https://script.google.com/macros/s/AKfycbzzDc0nSAmDzkY5U2rHlH8_ljr-7z0Klo8pcuw7SpkOoiDVEagec-BS4jQxyT0j22TWeg/exec"
        },
        {
          id: "doom-2",
          title: "Doom 2",
          desc: "Blast through demon-infested levels with an arsenal of powerful weapons. Face deadlier foes in bigger maps in this classic FPS sequel.",
          badge: "SHOOTER",
          emoji: "💀",
          image: "https://assets.nintendo.com/image/upload/c_fill,w_1200/q_auto:best/f_auto/dpr_2.0/store/software/switch/70010000018925/1892afd16e56eaedb6a3d73ef6d936c4f24e3f40bd17a541d360c1a47e564f83",
          url: "https://script.google.com/macros/s/AKfycbx61mSm2aEx_wwEQB66hIGUZm8hV2dBZvo2QXcabpXvc0r25c22pW-pdE8tmxBjOWcWCw/exec"
        }
      ],
      tools: [],
      apps: appData
    };

    const gameIndex = Object.fromEntries(sectionData.games.map(game => [game.id, game]));

    const suggestionData = [
      { title: "Clicker Picks", desc: "More fast idle games and clicker loops will appear here as the library expands.", badge: "SOON", emoji: "⚡" },
      { title: "Idle Progression", desc: "A future shelf for upgrade-heavy games with satisfying long-term progress.", badge: "QUEUE", emoji: "📈" },
      { title: "Cozy Classics", desc: "Lightweight browser favorites that fit the same quick-play rhythm.", badge: "NEXT", emoji: "✨" }
    ];

    const infoSearchData = [
      { title: "About Orbit", desc: "A modern browser hub for games, tools, proxies, and web apps.", badge: "INFO", emoji: "💫" },
      { title: "Games Library", desc: "46+ playable games with dedicated players and fullscreen support.", badge: "PLAY", emoji: "🎮" },
      { title: "Proxy Tools", desc: "Built-in proxy integration for unrestricted browsing with privacy controls.", badge: "PROXY", emoji: "🌐" },
      { title: "Custom Themes", desc: "Personalize colors, blur, particles, motion, and layout density.", badge: "STYLE", emoji: "🎨" }
    ];

    const searchPages = {
      games: { label: "Games", items: sectionData.games },
      tools: { label: "Tools", items: sectionData.tools },
      apps: { label: "Apps", items: sectionData.apps },
      info: { label: "Info", items: infoSearchData }
    };

    const SETTINGS_STORAGE_KEY = 'voltra-settings-v1';
    const BASE_PAGE_TITLE = 'Orbit';

    const defaultSettings = {
      music: true,
      sfx: true,
      particles: true,
      reducedMotion: false,
      musicVolume: 10,
      sfxVolume: 10,
      particleDensity: 'normal',
      glow: 100,
      accent: 'snow',
      compactCards: false,
      highContrast: false,
      sectionSearch: true,
      backgroundOrbs: true,
      smoothScroll: true,
      showPlayerSuggestions: true,
      tabCloak: false,
      autoTabCloak: true,
      cloakPreset: 'google',
      cloakCustomTitle: '',
      cloakCustomFavicon: '',
      autoExternalLaunch: false,
      autoLaunchMode: 'aboutBlank',
      autoLaunchOnLoad: false,
      requirePassword: false,
      websitePassword: '',
      username: '',
      autoLock: false,
      autoLockTime: '15',
      bypassKeybind: '',
      bgMusic: 'orbit',
      bgMusicCustomUrl: ''
    };

    const settings = { ...defaultSettings };
    let settingsPanel = 'audio';

    const cyclingPhrases = [
      "Welcome, username.",
      "Play Anything.",
      "Welcome to Orbit.",
      "Your gaming hub.",
      "Unblocked games await.",
      "Proxies at your fingertips.",
      "Tools for everything.",
      "Ready to play?",
      "Let's get started.",
      "Infinite possibilities.",
      "Your escape begins here.",
      "No limits, just fun.",
      "Browse freely.",
      "Access everything.",
      "Your playground awaits.",
      "Gaming redefined.",
      "The future of browsing.",
      "Your digital sanctuary.",
      "Unlock the web.",
      "Freedom to play.",
      "Your portal to fun.",
      "Where gaming lives.",
      "Your daily dose of fun.",
      "Entertainment unleashed.",
      "Your gaming companion.",
      "Play without limits.",
      "Your web oasis.",
      "Discover, play, enjoy.",
      "Your gaming destination.",
      "Fun awaits you.",
      "Your escape from boredom.",
      "Gaming made simple.",
      "Your personal arcade.",
      "Unlimited entertainment.",
      "Your web playground.",
      "Play, explore, repeat.",
      "Your gaming universe.",
      "Fun is just a click away.",
      "Your digital playground.",
      "Gaming without boundaries.",
      "Your entertainment hub.",
      "Where fun begins.",
      "Change your theme in Settings.",
      "Use the cog to customize audio and motion.",
      "Open games in a new tab from the cards.",
      "Adjust particles and glow from the Appearance panel.",
      "Find games, tools, and apps faster with search.",
      "Need help? Check Settings for advanced controls.",
      "Use the sidebar to switch between Games, Proxies, Tools, and Info.",
      "Save time with quick access cards and hidden features.",
      "Keep Orbit bookmarked for instant return.",
      "Your gaming sanctuary.",
      "Play freely.",
      "Your web escape.",
      "Gaming paradise.",
      "Your fun zone.",
      "Unblock your potential.",
      "Your gaming world.",
      "Entertainment at your fingertips.",
      "Your daily gaming fix.",
      "Play without restrictions.",
      "Your web gaming hub.",
      "Fun for everyone.",
      "Your gaming portal.",
      "Unlimited gaming.",
      "Your entertainment center.",
      "Where gamers gather.",
      "Your fun destination.",
      "Gaming without limits.",
      "Your web gaming world.",
      "Play anytime, anywhere.",
      "Your gaming escape.",
      "Entertainment unlimited.",
      "Your gaming oasis.",
      "Discover new games.",
      "Your gaming adventure.",
      "Play with freedom.",
      "Your web gaming paradise.",
      "Fun without boundaries.",
      "Your gaming haven.",
      "Unlock entertainment.",
      "Your gaming realm.",
      "Play your way.",
      "Your gaming universe awaits.",
      "Entertainment redefined.",
      "Your gaming journey.",
      "Play without worries.",
      "Your web gaming sanctuary.",
      "Fun for all.",
      "Your gaming experience.",
      "Unblock the fun.",
      "Your gaming destination awaits.",
      "Play with confidence.",
      "Your web gaming zone.",
      "Entertainment at its best.",
      "Your gaming paradise awaits.",
      "Discover endless fun.",
      "Your gaming adventure awaits.",
      "Play without fear.",
      "Your web gaming haven.",
      "Fun without limits.",
      "Your gaming world awaits.",
      "Unlock the gaming world.",
      "Your gaming escape awaits.",
      "Play with passion.",
      "Your web gaming destination.",
      "Entertainment for everyone.",
      "Your gaming journey awaits.",
      "Play without compromise.",
      "Your web gaming paradise awaits.",
      "Fun without restrictions.",
      "Your gaming haven awaits.",
      "Discover your gaming potential.",
      "Your gaming realm awaits.",
      "Play with style.",
      "Your web gaming world awaits.",
      "Entertainment without boundaries.",
      "Your gaming sanctuary awaits.",
      "Play with joy.",
      "Your web gaming escape awaits.",
      "Fun without compromise.",
      "Your gaming zone awaits.",
      "Unlock your gaming world.",
      "Your gaming destination awaits.",
      "Play with excitement.",
      "Your web gaming haven awaits.",
      "Entertainment without limits.",
      "Your gaming paradise awaits.",
      "Discover your gaming world.",
      "Your gaming adventure awaits.",
      "Play with enthusiasm.",
      "Your web gaming sanctuary awaits.",
      "Fun without fear.",
      "Your gaming world awaits.",
      "Unlock your gaming paradise.",
      "Your gaming escape awaits.",
      "Play with energy.",
      "Your web gaming destination awaits.",
      "Entertainment without compromise.",
      "Your gaming journey awaits.",
      "Play with creativity.",
      "Your web gaming paradise awaits.",
      "Fun without boundaries.",
      "Your gaming haven awaits.",
      "Discover your gaming sanctuary.",
      "Your gaming realm awaits.",
      "Play with imagination.",
      "Your web gaming world awaits.",
      "Entertainment without fear.",
      "Your gaming sanctuary awaits.",
      "Play with inspiration.",
      "Your web gaming escape awaits.",
      "Fun without hesitation.",
      "Your gaming zone awaits.",
      "Unlock your gaming haven.",
      "Your gaming destination awaits.",
      "Play with determination.",
      "Your web gaming haven awaits.",
      "Entertainment without hesitation.",
      "Your gaming paradise awaits.",
      "Discover your gaming haven.",
      "Your gaming adventure awaits.",
      "Play with confidence.",
      "Your web gaming sanctuary awaits.",
      "Fun without doubt.",
      "Your gaming world awaits.",

      "Unlock your gaming sanctuary.",
      "Your gaming escape awaits.",
      "Play with courage.",
      "Your web gaming destination awaits.",
      "Entertainment without doubt.",
      "Your gaming journey awaits.",
      "Play with strength.",
      "Your web gaming paradise awaits.",
      "Fun without worry.",
      "Your gaming haven awaits.",
      "Discover your gaming zone.",
      "Your gaming realm awaits.",
      "Play with power.",
      "Your web gaming world awaits.",
      "Entertainment without worry.",
      "Your gaming sanctuary awaits.",
      "Play with grace.",
      "Your web gaming escape awaits.",
      "Fun without stress.",
      "Your gaming zone awaits.",
      "Unlock your gaming zone.",
      "Your gaming destination awaits.",
      "Play with elegance.",
      "Your web gaming haven awaits.",
      "Entertainment without stress.",
      "Your gaming paradise awaits.",
      "Discover your gaming destination.",
      "Your gaming adventure awaits.",
      "Play with flair.",
      "Your web gaming sanctuary awaits.",
      "Fun without pressure.",
      "Your gaming world awaits.",
      "Unlock your gaming destination.",
      "Your gaming escape awaits.",
      "Play with charm.",
      "Your web gaming destination awaits.",
      "Entertainment without pressure.",
      "Your gaming journey awaits.",
      "Play with wit.",
      "Your web gaming paradise awaits.",
      "Fun without anxiety.",
      "Your gaming haven awaits.",
      "Discover your gaming journey.",
      "Your gaming realm awaits.",
      "Play with humor.",
      "Your web gaming world awaits.",
      "Entertainment without anxiety.",
      "Your gaming sanctuary awaits.",
      "Play with intelligence.",
      "Your web gaming escape awaits.",
      "Fun without frustration.",
      "Your gaming zone awaits.",
      "Unlock your gaming journey.",
      "Your gaming destination awaits.",
      "Play with wisdom.",
      "Your web gaming haven awaits.",
      "Entertainment without frustration.",
      "Your gaming paradise awaits.",
      "Discover your gaming wisdom.",
      "Your gaming adventure awaits.",
      "Play with knowledge.",
      "Your web gaming sanctuary awaits.",
      "Fun without confusion.",
      "Your gaming world awaits.",
      "Unlock your gaming wisdom.",
      "Your gaming escape awaits.",
      "Play with understanding.",
      "Your web gaming destination awaits.",
      "Entertainment without confusion.",
      "Your gaming journey awaits.",
      "Play with insight.",
      "Your web gaming paradise awaits.",
      "Fun without uncertainty.",
      "Your gaming haven awaits.",
      "Discover your gaming insight.",
      "Your gaming realm awaits.",
      "Play with vision.",
      "Your web gaming world awaits.",
      "Entertainment without uncertainty.",
      "Your gaming sanctuary awaits.",
      "Play with foresight.",
      "Your web gaming escape awaits.",
      "Fun without ambiguity.",
      "Your gaming zone awaits.",
      "Unlock your gaming insight.",
      "Your gaming destination awaits.",
      "Play with clarity.",
      "Your web gaming haven awaits.",
      "Entertainment without ambiguity.",
      "Your gaming paradise awaits.",
      "Discover your gaming clarity.",
      "Your gaming adventure awaits.",
      "Play with focus.",
      "Your web gaming sanctuary awaits.",
      "Fun without distraction.",
      "Your gaming world awaits.",
      "Unlock your gaming clarity.",
      "Your gaming escape awaits.",
      "Play with precision.",
      "Your web gaming destination awaits.",
      "Entertainment without distraction.",
      "Your gaming journey awaits.",
      "Play with accuracy.",
      "Your web gaming paradise awaits.",
      "Fun without error.",
      "Your gaming haven awaits.",
      "Discover your gaming precision.",
      "Your gaming realm awaits.",
      "Play with perfection.",
      "Your web gaming world awaits.",
      "Entertainment without error.",
      "Your gaming sanctuary awaits.",
      "Play with excellence.",
      "Your web gaming escape awaits.",
      "Fun without flaw.",
      "Your gaming zone awaits.",
      "Unlock your gaming precision.",
      "Your gaming destination awaits.",
      "Play with mastery.",
      "Your web gaming haven awaits.",
      "Entertainment without flaw.",
      "Your gaming paradise awaits.",
      "Discover your gaming mastery.",
      "Your gaming adventure awaits.",
      "Play with expertise.",
      "Your web gaming sanctuary awaits.",
      "Fun without mistake.",
      "Your gaming world awaits.",
      "Unlock your gaming mastery.",
      "Your gaming escape awaits.",
      "Play with skill.",
      "Your web gaming destination awaits.",
      "Entertainment without mistake.",
      "Your gaming journey awaits.",
      "Play with talent.",
      "Your web gaming paradise awaits.",
      "Fun without failure.",
      "Your gaming haven awaits.",
      "Discover your gaming talent.",
      "Your gaming realm awaits.",
      "Play with ability.",
      "Your web gaming world awaits.",
      "Entertainment without failure.",
      "Your gaming sanctuary awaits.",
      "Play with capability.",
      "Your web gaming escape awaits.",
      "Fun without weakness.",
      "Your gaming zone awaits.",
      "Unlock your gaming talent.",
      "Your gaming destination awaits.",
      "Play with competence.",
      "Your web gaming haven awaits.",
      "Entertainment without weakness.",
      "Your gaming paradise awaits.",
      "Discover your gaming competence.",
      "Your gaming adventure awaits.",
      "Play with proficiency.",
      "Your web gaming sanctuary awaits.",
      "Fun without limitation.",
      "Your gaming world awaits.",
      "Unlock your gaming competence.",
      "Your gaming escape awaits.",
      "Play with aptitude.",
      "Your web gaming destination awaits.",
      "Entertainment without limitation.",
      "Your gaming journey awaits.",
      "Play with capacity.",
      "Your web gaming paradise awaits.",
      "Fun without restriction.",
      "Your gaming haven awaits.",
      "Discover your gaming aptitude.",
      "Your gaming realm awaits.",
      "Play with potential.",
      "Your web gaming world awaits.",
      "Entertainment without restriction.",
      "Your gaming sanctuary awaits.",
      "Play with possibility.",
      "Your web gaming escape awaits.",
      "Fun without constraint.",
      "Your gaming zone awaits.",
      "Unlock your gaming potential.",
      "Your gaming destination awaits.",
      "Play with opportunity.",
      "Your web gaming haven awaits.",
      "Entertainment without constraint.",
      "Your gaming paradise awaits.",
      "Discover your gaming opportunity.",
      "Your gaming adventure awaits.",
      "Play with prospect.",
      "Your web gaming sanctuary awaits.",
      "Fun without barrier.",
      "Your gaming world awaits.",
      "Unlock your gaming opportunity.",
      "Your gaming escape awaits.",
      "Play with promise.",
      "Your web gaming destination awaits.",
      "Entertainment without barrier.",
      "Your gaming journey awaits.",
      "Play with hope.",
      "Your web gaming paradise awaits.",
      "Fun without obstacle.",
      "Your gaming haven awaits.",
      "Discover your gaming promise.",
      "Your gaming realm awaits.",
      "Play with aspiration.",
      "Your web gaming world awaits.",
      "Entertainment without obstacle.",
      "Your gaming sanctuary awaits.",
      "Play with ambition.",
      "Your web gaming escape awaits.",
      "Fun without hindrance.",
      "Your gaming zone awaits.",
      "Unlock your gaming promise.",
      "Your gaming destination awaits.",
      "Play with dream.",
      "Your web gaming haven awaits.",
      "Entertainment without hindrance.",
      "Your gaming paradise awaits.",
      "Discover your gaming dream.",
      "Your gaming adventure awaits.",
      "Play with vision.",
      "Your web gaming sanctuary awaits.",
      "Fun without impediment.",
      "Your gaming world awaits.",
      "Unlock your gaming dream.",
      "Your gaming escape awaits.",
      "Play with goal.",
      "Your web gaming destination awaits.",
      "Entertainment without impediment.",
      "Your gaming journey awaits.",
      "Play with target.",
      "Your web gaming paradise awaits.",
      "Fun without delay.",
      "Your gaming haven awaits.",
      "Discover your gaming goal.",
      "Your gaming realm awaits.",
      "Play with objective.",
      "Your web gaming world awaits.",
      "Entertainment without delay.",
      "Your gaming sanctuary awaits.",
      "Play with purpose.",
      "Your web gaming escape awaits.",
      "Fun without pause.",
      "Your gaming zone awaits.",
      "Unlock your gaming goal.",
      "Your gaming destination awaits.",
      "Play with mission.",
      "Your web gaming haven awaits.",
      "Entertainment without pause.",
      "Your gaming paradise awaits.",
      "Discover your gaming mission.",
      "Your gaming adventure awaits.",
      "Play with calling.",
      "Your web gaming sanctuary awaits.",
      "Fun without interruption.",
      "Your gaming world awaits.",
      "Unlock your gaming mission.",
      "Your gaming escape awaits.",
      "Play with destiny.",
      "Your web gaming destination awaits.",
      "Entertainment without interruption.",
      "Your gaming journey awaits.",
      "Play with fate.",
      "Your web gaming paradise awaits.",
      "Fun without break.",
      "Your gaming haven awaits.",
      "Discover your gaming destiny.",
      "Your gaming realm awaits."
    ];

    // dynamic word list for the hero typing word (shuffled each visit)
    const preferredFirstWords = ['gaming', 'unblocking', 'proxies', 'streaming', 'exploring', 'accessing'];

    const dynamicWords = [
      'gaming', 'unblocking', 'proxies', 'streaming', 'exploring', 'accessing', 'unlocking', 'browsing',
      'connecting', 'discovering', 'navigating', 'playing', 'searching', 'loading', 'launching', 'joining',
      'visiting', 'surfing', 'competing', 'solving', 'racing', 'opening', 'switching', 'finding'
    ];

    let wordQueue = [];
    let currentWord = '';
    let wordCycleInitialized = false;
    window.isTypingUsername = false;

    let currentPhraseIndex = undefined;
    let currentText = '';
    let isDeleting = false;
    // base typing speeds (ms) — tuned slightly slower for readability
    let baseTypingDelay = 85; // normal/quick typing (slightly slower)
    let baseDeletingDelay = 40;
    let pauseAfterTyping = 4200; // rest on full phrase longer
    let pauseAfterDeleting = 700;

    let phraseQueue = [];
    let recentPhraseHistory = [];

    function shuffleArray(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
    }

    function buildPhraseQueue() {
      phraseQueue = cyclingPhrases
        .map((_, idx) => idx)
        .filter(idx => settings.username || !/username/i.test(cyclingPhrases[idx]));
      shuffleArray(phraseQueue);

      if (settings.username) {
        const usernameIndex = cyclingPhrases.findIndex(p => /username/i.test(p));
        if (usernameIndex !== -1) {
          const pos = phraseQueue.indexOf(usernameIndex);
          if (pos > -1) phraseQueue.splice(pos, 1);
          phraseQueue.unshift(usernameIndex);
        }
      }

      const avoidIndexes = [...recentPhraseHistory].slice(-4);
      for (let i = 0; i < Math.min(3, phraseQueue.length); i++) {
        if (avoidIndexes.includes(phraseQueue[i])) {
          const avoid = phraseQueue.splice(i, 1)[0];
          phraseQueue.push(avoid);
          i--; // recheck the current position after rotation
        }
      }
    }

    function getNextPhraseIndex() {
      if (!phraseQueue.length) buildPhraseQueue();
      let nextIndex = phraseQueue.shift();
      if (nextIndex === undefined) return 0;
      if (!settings.username && /username/i.test(cyclingPhrases[nextIndex])) {
        return getNextPhraseIndex();
      }
      recentPhraseHistory.push(nextIndex);
      if (recentPhraseHistory.length > 6) recentPhraseHistory.shift();
      return nextIndex;
    }

    function typeCyclingText() {
      const heroTitle = document.querySelector('.hero h1');
      if (!heroTitle) return;

      // Initialize queue on first run
      if (!wordCycleInitialized) {
        wordQueue = dynamicWords.slice();
        shuffleArray(wordQueue);
        wordCycleInitialized = true;

        // If a username exists, type it first
        if (settings.username) {
          currentWord = String(settings.username);
          currentText = '';
          isDeleting = false;
          window.isTypingUsername = true;
        } else {
          // No username — start with a preferred word, then shuffle the rest
          const preferredIndex = wordQueue.findIndex(w => preferredFirstWords.includes(w));
          if (preferredIndex > -1) {
            currentWord = wordQueue.splice(preferredIndex, 1)[0];
          } else {
            currentWord = wordQueue.shift() || '';
          }
          currentText = '';
          isDeleting = false;
          window.isTypingUsername = false;
        }
      }

      let delay = baseTypingDelay;
      // Type/delete the current word only (the fixed prefix is "Welcome, ")
      if (isDeleting) {
        currentText = currentWord.substring(0, Math.max(0, currentText.length - 1));
        delay = baseDeletingDelay;
      } else {
        currentText = currentWord.substring(0, Math.min(currentWord.length, currentText.length + 1));
        delay = baseTypingDelay;
      }

      const displayWord = escapeHTML(currentText);
      const isUsername = window.isTypingUsername;
      const usernameClass = isUsername ? 'username-highlight' : '';
      const periodDisplay = !isDeleting && currentText.length === currentWord.length ? '.' : '';
      heroTitle.innerHTML = `Welcome <span class="typed-word ${usernameClass}">${displayWord}${periodDisplay}</span><span class="typing-caret" aria-hidden="true"></span>`;

      if (!isDeleting && currentText.length === currentWord.length) {
        // finished typing current word/username — pause then delete
        if (isUsername) {
          // After typing username, pause longer then transition to words
          isDeleting = true;
          delay = 2000;
        } else {
          isDeleting = true;
          delay = pauseAfterTyping;
        }
      } else if (isDeleting && currentText.length === 0) {
        // finished deleting — get next word and start typing
        isDeleting = false;
        
        if (isUsername) {
          // Transition from username to first word
          window.isTypingUsername = false;
          const preferredIndex = wordQueue.findIndex(w => preferredFirstWords.includes(w));
          if (preferredIndex > -1) {
            currentWord = wordQueue.splice(preferredIndex, 1)[0];
          } else {
            currentWord = wordQueue.shift() || '';
          }
        } else {
          // Cycle through words normally
          currentWord = wordQueue.shift() || '';
          if (!currentWord) {
            wordQueue = dynamicWords.slice();
            shuffleArray(wordQueue);
            currentWord = wordQueue.shift() || '';
          }
        }
        delay = pauseAfterDeleting;
      }

      setTimeout(typeCyclingText, delay);
    }

    const cloakPresets = {
      google: { title: 'Google', icon: 'https://www.google.com/favicon.ico' },
      classroom: { title: 'Google Classroom', icon: 'https://ssl.gstatic.com/classroom/favicon.png' },
      drive: { title: 'Google Drive', icon: 'https://docs.google.com/favicon.ico' },
      docs: { title: 'Google Docs', icon: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon-2023q4.ico' },
      home: { title: 'Google', icon: 'https://www.google.com/favicon.ico' }
    };

    function loadStoredSettings() {
      try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (!raw) return;
        const stored = JSON.parse(raw);
        Object.keys(defaultSettings).forEach(key => {
          if (stored[key] !== undefined) settings[key] = stored[key];
        });
        if (stored.settingsPanel) settingsPanel = stored.settingsPanel;
      } catch (err) {
        console.warn('Could not load saved settings.', err);
      }
    }

    function saveStoredSettings() {
      try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
          ...settings,
          settingsPanel
        }));
      } catch (err) {
        console.warn('Could not save settings.', err);
      }
    }

    function setPageFavicon(href) {
      let link = document.querySelector('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = href;
    }

    function restoreTabIdentity() {
      document.title = BASE_PAGE_TITLE;
      setPageFavicon('data:,');
    }

    function applyTabCloak() {
      if (!settings.tabCloak) {
        restoreTabIdentity();
        return;
      }

      const preset = cloakPresets[settings.cloakPreset] || cloakPresets.google;
      document.title = settings.cloakCustomTitle.trim() || preset.title;
      
      if (settings.cloakPreset === 'custom' && settings.cloakCustomFavicon) {
        setPageFavicon(settings.cloakCustomFavicon.trim());
      } else {
        setPageFavicon(preset.icon);
      }
    }

    function updateTabCloakState() {
      if (settings.autoTabCloak) {
        if (document.hidden) applyTabCloak();
        else restoreTabIdentity();
        return;
      }

      if (!settings.tabCloak) {
        restoreTabIdentity();
        return;
      }

      applyTabCloak();
    }

    function buildEmbeddedTabHTML(url, title) {
      const src = encodeURI(url);
      const safeTitle = escapeHTML(title);
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #020409; }
    iframe { border: 0; width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  <iframe src="${src}" title="${safeTitle}" allow="fullscreen" allowfullscreen loading="lazy"></iframe>
</body>
</html>`;
    }

    function openUrlInAboutBlank(url, title) {
      const tab = window.open('about:blank', '_blank');
      if (!tab) return null;

      tab.opener = null;
      tab.document.open();
      tab.document.write(buildEmbeddedTabHTML(url, title));
      tab.document.close();
      return tab;
    }

    function openUrlInBlobTab(url, title) {
      const html = buildEmbeddedTabHTML(url, title);
      const blob = new Blob([html], { type: 'text/html' });
      const blobUrl = URL.createObjectURL(blob);
      const tab = window.open(blobUrl, '_blank');

      if (tab) tab.opener = null;
      setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
      return tab;
    }

    function launchExternalTab(url, title, mode) {
      if (mode === 'blob') return openUrlInBlobTab(url, title);
      return openUrlInAboutBlank(url, title);
    }

    function maybeAutoLaunchExternal(url, title) {
      if (!settings.autoExternalLaunch || !url) return;
      launchExternalTab(url, title, settings.autoLaunchMode);
    }

    loadStoredSettings();

    const musicSources = {
      orbit: 'https://files.catbox.moe/vgjm1c.mp3',
      minecraft: 'https://files.catbox.moe/jeql5p.mp3',
      zelda: 'https://files.catbox.moe/udpn7n.mp3',
      rapbeats: 'https://files.catbox.moe/3x5bfe.mp3',
    };

    function initBgMusic() {
      if (settings.bgMusic === 'custom') {
        const url = settings.bgMusicCustomUrl;
        if (url && isValidAudioUrl(url)) {
          music.src = url;
          music.load();
        }
      } else if (settings.bgMusic !== 'orbit') {
        const src = musicSources[settings.bgMusic];
        if (src) {
          music.src = src;
          music.load();
        }
      }
    }

    initBgMusic();

    let musicFadeFrame = null;
    let gameMusicPausedByFade = false;

    function cancelMusicFade() {
      if (musicFadeFrame !== null) {
        cancelAnimationFrame(musicFadeFrame);
        musicFadeFrame = null;
      }
    }

    function fadeMusicTo(targetVolume, duration, onComplete) {
      cancelMusicFade();
      const startVolume = music.volume;
      const startTime = performance.now();
      const delta = targetVolume - startVolume;

      function step(now) {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        music.volume = Math.max(0, Math.min(1, startVolume + delta * eased));
        if (progress < 1) {
          musicFadeFrame = requestAnimationFrame(step);
        } else {
          musicFadeFrame = null;
          if (onComplete) onComplete();
        }
      }

      musicFadeFrame = requestAnimationFrame(step);
    }

    function fadeMusicOutForGame() {
      if (!settings.music || music.muted) return;
      gameMusicPausedByFade = gameMusicPausedByFade || !music.paused;
      fadeMusicTo(0, 280, () => {
        if (currentSection === 'game') music.pause();
      });
    }

    function fadeMusicInAfterGame() {
      const targetVolume = settings.musicVolume / 100;
      if (!settings.music) return;
      cancelMusicFade();
      music.volume = 0;
      if (gameMusicPausedByFade) {
        music.play().catch(() => {});
      }
      gameMusicPausedByFade = false;
      fadeMusicTo(targetVolume, 320);
    }

    const accentThemes = {
      snow: { a: '255,255,255', b: '255,255,255', c: '255,255,255' },
      sunset: { a: '255,120,80', b: '255,160,100', c: '255,200,140' },
      grape: { a: '180,100,255', b: '140,70,220', c: '200,130,255' },
      dracula: { a: '255,85,85', b: '220,60,60', c: '255,120,120' },
      ocean: { a: '80,180,255', b: '60,150,220', c: '100,200,255' },
      forest: { a: '80,200,120', b: '60,170,90', c: '100,220,140' },
      lavender: { a: '200,150,255', b: '170,120,220', c: '220,180,255' },
      amber: { a: '255,200,80', b: '220,170,60', c: '255,220,100' },
      rose: { a: '255,120,180', b: '220,90,150', c: '255,150,200' }
    };

    const particleDensityMap = {
      low: 80,
      normal: 160,
      high: 260
    };

    let currentSection = null;
    let returnSection = 'games';
    let lastBrowseQuery = '';
    let heroSearchWidthInitialized = false;
    let firstGamesPageLoad = true;

    function scrollBehavior() {
      return settings.smoothScroll ? 'smooth' : 'auto';
    }

    const heroSection = document.getElementById('heroSection');
    const mainContent = document.getElementById('mainContent');
    const homeSearchStack = document.getElementById('homeSearchStack');
    const homeSearchResults = document.getElementById('homeSearchResults');
    const homeSearchInput = document.getElementById('homeSearchInput');

    const fullPageSections = ['settings', 'games', 'search', 'tools', 'apps', 'info', 'browser'];

    function escapeHTML(value) {
      return String(value)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"');
    }

    function buildThumb(item) {
      if (item.image) {
        return `<img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.title)} icon">`;
      }
      return `<span>${item.emoji}</span>`;
    }

    function buildGameCards(items, section) {
      return items.map(item => `
        <div class="game-item" ${cardOpenAttrs(section, item)}>
          <div class="game-card">
            <div class="game-thumb">${buildThumb(item)}</div>
          </div>
          <div class="game-card-title">${escapeHTML(item.title)}</div>
        </div>
      `).join('');
    }

    function cardOpenAttrs(section, item) {
      if (!item.url || !item.id) return '';
      return `role="button" tabindex="0" onclick="openGame('${item.id}')" onkeydown="handleCardKey(event, '${item.id}', '${section}')"`;
    }

    const backButtonHTML = `
      <button class="icon-btn" data-tooltip="Back" onclick="backFromPlayer()" aria-label="Back">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 12H5"></path>
          <path d="M12 19l-7-7 7-7"></path>
        </svg>
      </button>`;

    const fullscreenButtonHTML = `
      <button class="icon-btn" data-tooltip="Fullscreen" onclick="fullscreenFrame()" aria-label="Fullscreen">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 3H3v5"></path>
          <path d="M16 3h5v5"></path>
          <path d="M21 16v5h-5"></path>
          <path d="M3 16v5h5"></path>
          <path d="M3 3l6 6"></path>
          <path d="M21 3l-6 6"></path>
          <path d="M21 21l-6-6"></path>
          <path d="M3 21l6-6"></path>
        </svg>
      </button>`;

    function incognitoButtonHTML(id) {
      return `
        <button class="icon-btn" data-tooltip="Open in Incognito Tab" onclick="openProxyBlankTab('${id}')" aria-label="Open in incognito tab">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3c-3.4 0-6.3 2.1-7.5 5.1"></path>
            <path d="M12 3c3.4 0 6.3 2.1 7.5 5.1"></path>
            <path d="M4.4 9.6C5.3 14.3 8.2 18 12 18s6.7-3.7 7.6-8.4"></path>
            <circle cx="9" cy="11" r="1.1"></circle>
            <circle cx="15" cy="11" r="1.1"></circle>
          </svg>
        </button>`;
    }

    function newTabButtonHTML(id, type) {
      const handler = type === 'proxy' ? `openProxyTab('${id}')` : `openGameTab('${id}')`;
      return `
        <button class="icon-btn" data-tooltip="Open in New Tab" onclick="${handler}" aria-label="Open in new tab">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 3h7v7"></path>
            <path d="M10 14L21 3"></path>
            <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path>
          </svg>
        </button>`;
    }

    function buildGamesHTML(section, query = '') {
      const titles = {
        games: "Games",
        proxies: "Proxies",
        tools: "Tools",
        apps: "Apps"
      };

      const source = sectionData[section] || [];
      const items = source.filter(i => i.title.toLowerCase().includes(query.toLowerCase()));

      return `
        <div class="section">
          ${settings.sectionSearch ? `
            <div class="section-search">
              <div class="search-input-wrapper">
                <input
                  id="searchInput"
                  oninput="handleSearch(this.value)"
                  placeholder="Search ${titles[section] ? titles[section].toLowerCase() : section}"
                  aria-label="Search Orbit for ${titles[section] ? titles[section].toLowerCase() : section}">
                <span class="search-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M10 18a8 8 0 1 1 5.29-2.12l4.9 4.9-1.42 1.42-4.9-4.9A7.96 7.96 0 0 1 10 18zm0-14a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"></path></svg>
                </span>
              </div>
            </div>
          ` : ''}
          <div class="games-grid" id="gamesGrid">${buildGameCards(items, section)}</div>
        </div>
      `;
    }

    function buildGamePage(id) {
      const game = gameIndex[id] || sectionData.games[0];

      return `
        <div class="game-page-fullscreen">
          <!-- Game Notch -->
          <div class="game-notch" id="gameNotch">
            <div class="game-notch-left">
              <div class="game-notch-icon">
                <img src="${escapeHTML(game.image)}" alt="${escapeHTML(game.title)} icon">
              </div>
              <div class="game-notch-title">
                <h3>${escapeHTML(game.title)}</h3>
              </div>
            </div>
            <div class="game-notch-center">
              <div class="game-notch-battery" id="gameNotchBattery">
                <svg viewBox="0 0 24 24" fill="currentColor" class="battery-icon">
                  <rect x="2" y="7" width="16" height="10" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/>
                  <rect x="18" y="10" width="3" height="4" rx="1" ry="1" fill="currentColor"/>
                  <rect x="4" y="9" width="12" height="6" rx="1" ry="1" fill="currentColor" class="battery-level"/>
                </svg>
                <svg viewBox="0 0 24 24" fill="currentColor" class="charging-icon" style="display:none;">
                  <path d="M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66.19-.34.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21z"/>
                </svg>
              </div>
              <div class="game-notch-time" id="gameNotchTime"></div>
            </div>
            <div class="game-notch-right">
              <button class="game-notch-btn" onclick="backFromPlayer()" title="Back to Games">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                </svg>
              </button>
              <button class="game-notch-btn" onclick="refreshGame()" title="Refresh Game">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                </svg>
              </button>
              <button class="game-notch-btn" onclick="openGameTab()" title="Open in New Tab">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>
                </svg>
              </button>
              <button class="game-notch-control" onclick="toggleGameNotch()" title="Toggle Notch">
                <svg viewBox="0 0 24 24" fill="currentColor" class="notch-toggle-icon">
                  <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Game Notch Toggle (separate from notch) -->
          <div class="game-notch-toggle" id="gameNotchToggle" onclick="toggleGameNotch()">
            <svg viewBox="0 0 24 24" fill="currentColor" class="notch-arrow-up">
              <path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/>
            </svg>
            <svg viewBox="0 0 24 24" fill="currentColor" class="notch-arrow-down" style="display:none;">
              <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/>
            </svg>
          </div>

          <!-- Game Embed -->
          <div class="game-embed-container">
            <div class="game-loading-overlay" id="gameLoadingOverlay">
              <div class="game-loading-spinner"></div>
            </div>
            <iframe
              id="gameFrame"
              class="game-embed"
              data-src="${escapeHTML(game.url)}"
              title="${escapeHTML(game.title)}"
              allow="fullscreen; pointer-lock; microphone; camera; autoplay"
              allowfullscreen
              loading="lazy"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-pointer-lock"></iframe>
          </div>
        </div>
      `;
    }

    function buildInfoHTML() {
      return `
        <div class="info-page">
          <div class="info-wrap">
            <section class="info-hero">
              <h1>Orbit</h1>
              <div class="tagline">Your browser hub for games, tools, and more.</div>
              <p>A modern launchpad designed for speed, simplicity, and style. Orbit brings together games, proxy tools, utilities, and web apps in a clean, atmospheric interface.</p>
              <div class="info-stats">
                <div class="info-stat">
                  <strong>46+</strong>
                  <span>Games</span>
                </div>
                <div class="info-stat">
                  <strong>v1.3</strong>
                  <span>Latest</span>
                </div>
                <div class="info-stat">
                  <strong>Early</strong>
                  <span>Access</span>
                </div>
              </div>
            </section>

            <div class="info-features">
              <div class="info-feature">
                <span class="icon">🎮</span>
                <h3>Games Library</h3>
                <p>46+ playable games with dedicated players, fullscreen support, and smooth performance.</p>
              </div>
              <div class="info-feature">
                <span class="icon">🌐</span>
                <h3>Proxy Tools</h3>
                <p>Built-in proxy integration for unrestricted browsing with privacy controls.</p>
              </div>
              <div class="info-feature">
                <span class="icon">🧰</span>
                <h3>Utilities</h3>
                <p>Lightweight tools for notes, tabs, links, and everyday browser workflows.</p>
              </div>
              <div class="info-feature">
                <span class="icon">🎨</span>
                <h3>Custom Themes</h3>
                <p>Personalize colors, blur, particles, motion, and layout density.</p>
              </div>
              <div class="info-feature">
                <span class="icon">⚙️</span>
                <h3>Settings</h3>
                <p>Fine-tune audio, visuals, contrast, and behavior to match your preferences.</p>
              </div>
              <div class="info-feature">
                <span class="icon">🔄</span>
                <h3>Regular Updates</h3>
                <p>New features, games, and improvements shipped frequently.</p>
              </div>
            </div>

            <div class="info-bottom">
              <div class="version">Orbit v1.3 — Early Access</div>
              <p>Built for speed, privacy, and play.</p>
            </div>
          </div>
        </div>
      `;
    }

    function formatSettingValue(id) {
      if (id === 'musicVolume' || id === 'sfxVolume' || id === 'glow') return `${settings[id]}%`;
      return settings[id];
    }

    function buildSettingsHTML() {
      const toggleRow = (id, title, desc, checked) => `
        <div class="settings-row">
          <div class="settings-row-left">
            <h4>${title}</h4>
            <p>${desc}</p>
          </div>
          <div class="settings-control">
            <label class="toggle">
              <input type="checkbox" id="setting-${id}" ${checked ? 'checked' : ''} onchange="onToggle('${id}', this.checked)">
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      `;

      const rangeRow = (id, title, desc, min, max, step) => `
        <div class="settings-row">
          <div class="settings-row-left">
            <h4>${title}</h4>
            <p>${desc}</p>
          </div>
          <div class="settings-control">
            <input class="settings-range" type="range" min="${min}" max="${max}" step="${step}" value="${settings[id]}" oninput="onRange('${id}', this.value)">
            <span class="settings-value" id="${id}-value">${formatSettingValue(id)}</span>
          </div>
        </div>
      `;

      const selectRow = (id, title, desc, options) => `
        <div class="settings-row">
          <div class="settings-row-left">
            <h4>${title}</h4>
            <p>${desc}</p>
          </div>
          <div class="settings-control">
            <select class="settings-select" onchange="onSelect('${id}', this.value)">
              ${options.map(opt => `<option value="${opt.value}" ${settings[id] === opt.value ? 'selected' : ''}>${opt.label}</option>`).join('')}
            </select>
          </div>
        </div>
      `;

      const segmentRow = (id, title, desc, options) => `
        <div class="settings-row">
          <div class="settings-row-left">
            <h4>${title}</h4>
            <p>${desc}</p>
          </div>
          <div class="settings-control">
            <div class="segmented">
              ${options.map(opt => `<button type="button" class="${settings[id] === opt.value ? 'active' : ''}" onclick="setOption('${id}', '${opt.value}')">${opt.label}</button>`).join('')}
            </div>
          </div>
        </div>
      `;

      const textRow = (id, title, desc, placeholder) => `
        <div class="settings-row">
          <div class="settings-row-left">
            <h4>${title}</h4>
            <p>${desc}</p>
          </div>
          <div class="settings-control">
            <input
              class="settings-text"
              type="text"
              id="setting-${id}"
              value="${escapeHTML(settings[id] || '')}"
              placeholder="${escapeHTML(placeholder)}"
              oninput="onTextSetting('${id}', this.value)">
          </div>
        </div>
      `;

      const panel = (id, title, desc, rows) => `
        <section class="settings-panel ${settingsPanel === id ? 'active' : ''}" data-panel="${id}">
          <header class="settings-panel-head">
            <h3>${title}</h3>
            <p>${desc}</p>
          </header>
          <div class="settings-panel-body">${rows}</div>
        </section>
      `;

      // settingsNavIconHTML declared once below; keep this block focused on panel content.

      const bgMusicOptions = [
        { value: 'orbit', label: 'Orbit (Default)' },
        { value: 'minecraft', label: 'Minecraft' },
        { value: 'zelda', label: 'Zelda' },
        { value: 'rapbeats', label: 'Rap Beats' },
        { value: 'custom', label: 'Custom' },
      ];

      const audioPanel = panel('audio', 'Audio', 'Control background music and interface sound effects.', `
        ${toggleRow('music', 'Background Music', 'Play atmospheric music while you browse.', settings.music)}
        ${rangeRow('musicVolume', 'Music Volume', 'Set the background music level.', 0, 50, 1)}
        <div class="settings-row">
          <div class="settings-row-left">
            <h4>Select Background Music</h4>
            <p>Choose the music source for the homepage.</p>
          </div>
          <div class="settings-control">
            <div class="settings-custom-select">
              <button class="settings-custom-select-trigger" onclick="toggleBgMusicDropdown()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleBgMusicDropdown()}" aria-haspopup="listbox" aria-expanded="false" role="combobox">
                <span class="settings-custom-select-label">${bgMusicLabels[settings.bgMusic] || 'Orbit (Default)'}</span>
                <svg class="settings-custom-select-chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
              </button>
              <div class="settings-custom-select-options" role="listbox">
                ${bgMusicOptions.map(opt => `
                  <button class="settings-custom-select-option${settings.bgMusic === opt.value ? ' selected' : ''}" data-value="${opt.value}" role="option" aria-selected="${settings.bgMusic === opt.value}" onclick="selectBgMusic('${opt.value}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectBgMusic('${opt.value}')}">${opt.label}</button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
        <div class="settings-custom-url-row" id="customMusicUrlRow" style="display: ${settings.bgMusic === 'custom' ? 'block' : 'none'}; max-height: ${settings.bgMusic === 'custom' ? '150px' : '0'}; opacity: ${settings.bgMusic === 'custom' ? '1' : '0'};">
          <div class="settings-row" style="border-bottom: none; padding: 0;">
            <div class="settings-row-left">
              <h4>Custom Music URL</h4>
              <p>Enter a direct URL to an audio file.</p>
            </div>
            <div class="settings-control">
              <input class="settings-text" type="text" id="setting-bgMusicCustomUrl" value="${escapeHTML(settings.bgMusicCustomUrl || '')}" placeholder="https://example.com/music.mp3" oninput="onBgMusicCustomUrl(this.value)">
            </div>
          </div>
        </div>
        ${toggleRow('sfx', 'Sound Effects', 'Play hover and interaction sounds.', settings.sfx)}
        ${rangeRow('sfxVolume', 'Sound Effect Volume', 'Adjust hover and interaction sound volume.', 0, 50, 1)}
        <div class="settings-note">
          All settings are locally saved unless instructed otherwise.
        </div>
      `);

      // Dedicated sidebar tab labels/content mapping (UI only).
      // We keep underlying panel ids the same to avoid breaking logic; only labels/icons are updated in the nav.


      const appearancePanel = panel('appearance', 'Visuals', 'Tune colors, glow, particles, and background atmosphere.', `
        ${selectRow('accent', 'Accent Theme', 'Change the tint of interface highlights and accents.', [
          { value: 'snow', label: 'Snow' },
          { value: 'sunset', label: 'Sunset' },
          { value: 'grape', label: 'Grape' },
          { value: 'dracula', label: 'Dracula' },
          { value: 'ocean', label: 'Ocean' },
          { value: 'forest', label: 'Forest' },
          { value: 'lavender', label: 'Lavender' },
          { value: 'amber', label: 'Amber' },
          { value: 'rose', label: 'Rose' }
        ])}
        ${rangeRow('glow', 'Glow Intensity', 'Control the overall glow brightness across the interface.', 0, 200, 1)}
        ${toggleRow('particles', 'Particles', 'Show ambient floating particles in the background.', settings.particles)}
        ${segmentRow('particleDensity', 'Particle Density', 'Number of particles rendered in the background.', [
          { value: 'low', label: 'Low' },
          { value: 'normal', label: 'Normal' },
          { value: 'high', label: 'High' }
        ])}
        ${toggleRow('backgroundOrbs', 'Background Orbs', 'Display soft glowing orbs behind the main content.', settings.backgroundOrbs)}
        ${toggleRow('smoothScroll', 'Smooth Scrolling', 'Use animated smooth scrolling when navigating.', settings.smoothScroll)}
      `);

      // NOTE: Panel ids are used by the sidebar buttons.
      // We map the UI labels/icons to these existing panels without changing underlying setting logic.

      const layoutPanel = panel('layout', 'Cloaking', 'Tab cloaking and privacy settings.', `
        ${toggleRow('tabCloak', 'Tab Cloaking', 'Change the page title to hide activity.', settings.tabCloak)}
        ${toggleRow('autoTabCloak', 'Auto Cloak on Leave', 'Automatically cloak the tab when switching away. (Requires Tab Cloaking enabled)', settings.autoTabCloak)}
        ${selectRow('cloakPreset', 'Cloak Preset', 'Choose a preset page title.', [
          { value: 'google', label: 'Google' },
          { value: 'classroom', label: 'Google Classroom' },
          { value: 'docs', label: 'Google Docs' },
          { value: 'drive', label: 'Google Drive' },
          { value: 'custom', label: 'Custom' }
        ])}
        ${settings.cloakPreset === 'custom' ? textRow('cloakCustomTitle', 'Custom Cloak Title', 'Enter a custom tab title.', 'My Custom Title') : ''}
        ${settings.cloakPreset === 'custom' ? textRow('cloakCustomFavicon', 'Custom Favicon URL', 'Enter a custom favicon URL.', 'https://example.com/favicon.ico') : ''}
      `);

      // UI-only placeholder panel for the sidebar 'Account' tab.
      // It keeps the app stable while we correct UI mapping; if you later add account fields,
      // they should be wired into this panel.
      const performancePanel = panel('performance', 'Account', 'User profile and identity settings.', `
        ${textRow('username', 'Username', 'Set a name to personalize the welcome message.', 'Enter a username')}
        ${toggleRow('requirePassword', 'Require Password', 'Protect access with a site password.', settings.requirePassword)}
        ${textRow('websitePassword', 'Website Password', 'Set the password required to enter the site.', 'Enter password')}
        ${toggleRow('autoLock', 'Auto Lock', 'Lock the site after inactivity.', settings.autoLock)}
        ${selectRow('autoLockTime', 'Auto Lock Time', 'Minutes of inactivity before auto-locking.', [
          { value: '5', label: '5 minutes' },
          { value: '15', label: '15 minutes' },
          { value: '30', label: '30 minutes' },
          { value: '60', label: '1 hour' }
        ])}
        ${textRow('bypassKeybind', 'Bypass Keybind', 'Hold Shift + this key to bypass the password screen.', 'e.g. B')}
      `);

      const launchingPanel = panel('launching', 'Launching', 'Game and browser launch behavior settings.', `
        ${toggleRow('autoExternalLaunch', 'Auto External Launch', 'Automatically open games outside Orbit.', settings.autoExternalLaunch)}
        ${toggleRow('autoLaunchOnLoad', 'Auto Launch on Load', 'Open an about:blank tab on page load.', settings.autoLaunchOnLoad)}
      `);

      const browserPanel = panel('browser', 'Browser', 'Browser launch and behavior settings.', `
        <div class="settings-note">Browser settings will be added in a future update.</div>
      `);

      const aboutPanel = panel('about', 'About', 'Orbit version and data management.', `
        <div class="settings-about-card">
          <strong>🚀 Orbit v2.1</strong>
          <p>A sleek black-and-white command deck for games, tools, browsing, and immersive web experiences.</p>
          <div class="settings-about-meta">
            <span>Early Access</span>
            <span>Local Storage</span>
          </div>
        </div>
        <button class="settings-reset" type="button" onclick="resetSettings()">Reset All Settings</button>
        <button class="settings-reset" type="button" onclick="wipeAllData()" style="margin-top:8px; border-color:rgba(255,80,80,0.3);">Wipe All Data</button>
      `);

      const helpPanel = panel('help', 'Help', 'Frequently asked questions, quick start guide, and troubleshooting.', `
        <div class="help-section" style="animation-delay:0ms">
          <h4 class="help-section-title">Frequently Asked Questions</h4>
          <p class="help-section-desc">Common questions about using Orbit.</p>
          <div style="display:grid;gap:10px;width:100%;">
            <details class="help-card">
              <summary>How do I create my own Orbit links?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Orbit uses the Ultraviolet proxy to create encoded links. Open the Browser tab, navigate to any site, and the URL bar will show the proxied link. You can copy and share that link with others.</div>
            </details>
            <details class="help-card">
              <summary>How do I host Orbit myself?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Clone the repository from GitHub, install Node.js dependencies, and run the server locally. See the Quick Start guide below for detailed steps. You can also deploy to Railway or any Node.js-compatible platform.</div>
            </details>
            <details class="help-card">
              <summary>How do I deploy using Railway?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Fork the repository, connect your GitHub account to Railway, create a new project from the fork, and set the start command to node server.js. Railway handles the rest automatically.</div>
            </details>
            <details class="help-card">
              <summary>Why do some websites not load?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Some sites block proxy connections or require modern browser features. Try switching search engines in the browser settings, clearing the proxy cache, or loading the site directly without the proxy.</div>
            </details>
            <details class="help-card">
              <summary>How do proxy links work?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Orbit encodes the target URL using the Ultraviolet XOR codec and routes traffic through a service worker and bare server. This makes it appear as if you are browsing a different site.</div>
            </details>
            <details class="help-card">
              <summary>Can I customize Orbit?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Yes. Use Settings to change accent themes, glow intensity, particles, cloaking, audio, and more. The Visuals panel gives you full control over the look and feel of the interface.</div>
            </details>
            <details class="help-card">
              <summary>Where are themes located?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Themes are built into the codebase. You can select from nine accent themes in Settings of the Appearance panel. Custom themes are not yet supported but may be added in future updates.</div>
            </details>
            <details class="help-card">
              <summary>How do I update Orbit?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Pull the latest changes from the GitHub repository. If deployed on Railway, reconnect your project to the repository and Railway will redeploy automatically.</div>
            </details>
            <details class="help-card">
              <summary>How do I report bugs?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Open an issue on the GitHub repository with a description of the bug, steps to reproduce, and any console errors. Include your browser version and OS for faster resolution.</div>
            </details>
            <details class="help-card">
              <summary>How do I clear cached proxy data?<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-answer">Go to your browser's developer tools, navigate to Application Service Workers, and unregister the service worker. Then clear your browser cache and reload Orbit. This resets all proxy state.</div>
            </details>
          </div>
        </div>

        <div class="help-section" style="animation-delay:60ms">
          <h4 class="help-section-title">Quick Start</h4>
          <p class="help-section-desc">Get Orbit up and running in minutes.</p>
          <div class="help-timeline">
            <div class="help-timeline-step">
              <div class="help-timeline-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </div>
              <div class="help-timeline-content">
                <strong>Clone the repository</strong>
                <span><code>git clone https://github.com/your-username/orbit.git</code></span>
              </div>
            </div>
            <div class="help-timeline-step">
              <div class="help-timeline-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
              </div>
              <div class="help-timeline-content">
                <strong>Install dependencies</strong>
                <span><code>npm install</code></span>
              </div>
            </div>
            <div class="help-timeline-step">
              <div class="help-timeline-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="2" y1="14" x2="6" y2="14"/><line x1="10" y1="12" x2="14" y2="12"/><line x1="18" y1="16" x2="22" y2="16"/></svg>
              </div>
              <div class="help-timeline-content">
                <strong>Start the server</strong>
                <span><code>node server.js</code></span>
                <span>Orbit runs on <code>http://localhost:8080</code></span>
              </div>
            </div>
            <div class="help-timeline-step">
              <div class="help-timeline-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </div>
              <div class="help-timeline-content">
                <strong>Deploy (optional)</strong>
                <span>Connect your GitHub fork to Railway for free hosting. Set the start command to <code>node server.js</code>.</span>
              </div>
            </div>
          </div>
        </div>

        <div class="help-section" style="animation-delay:120ms">
          <h4 class="help-section-title">Troubleshooting</h4>
          <p class="help-section-desc">Common issues and their fixes.</p>
          <div style="display:grid;gap:8px;width:100%;">
            <details class="help-category">
              <summary class="help-category-btn">Proxy<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-category-solution">If proxy pages fail to load, try switching search engines or clearing the service worker cache. Some websites block known proxy IP ranges.</div>
            </details>
            <details class="help-category">
              <summary class="help-category-btn">Games<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-category-solution">Ensure your browser supports iframe embeds and that the game URL is accessible. Some games require direct loading (no proxy) which Orbit handles automatically.</div>
            </details>
            <details class="help-category">
              <summary class="help-category-btn">Downloads<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-category-solution">Hard refresh (Ctrl+Shift+R) to bypass cached assets. Clear your browser cache in Settings Privacy if pages appear broken.</div>
            </details>
            <details class="help-category">
              <summary class="help-category-btn">Cache<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-category-solution">Open DevTools, go to Application Service Workers, click Unregister. Reload the page. This fixes most proxy and UV initialization issues.</div>
            </details>
            <details class="help-category">
              <summary class="help-category-btn">Service Worker<svg class="help-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6l4 4 4-4"/></svg></summary>
              <div class="help-category-solution">Restart the server, update Node.js, check for port conflicts on 8080, and verify the UV bundle files are present in the <code>uv/</code> directory.</div>
            </details>
          </div>
        </div>

        <div class="help-section" style="animation-delay:180ms">
          <h4 class="help-section-title">Helpful Links</h4>
          <p class="help-section-desc">Resources to help you get the most out of Orbit.</p>
          <div class="help-links">
            <a href="https://github.com/your-username/orbit" target="_blank" class="help-link-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              GitHub
            </a>
            <a href="https://railway.app" target="_blank" class="help-link-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
              Railway
            </a>
            <a href="https://github.com/your-username/orbit/wiki" target="_blank" class="help-link-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              Documentation
            </a>
            <a href="https://discord.gg/orbit" target="_blank" class="help-link-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.074.074 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
              Discord
            </a>
          </div>
        </div>
      `);

      const settingsNavIconHTML = (panelId) => {
        switch (panelId) {
          case 'audio':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M560-131v-82q90-26 145-100t55-168q0-94-55-168T560-749v-82q124 28 202 125.5T840-481q0 127-78 224.5T560-131ZM120-360v-240h160l200-200v640L280-360H120Zm440 40v-322q47 22 73.5 66t26.5 96q0 51-26.5 94.5T560-320ZM400-606l-86 86H200v80h114l86 86v-252ZM300-480Z"/></svg>`;

          case 'appearance':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 32.5-156t88-127Q256-817 330-848.5T488-880q80 0 151 27.5t124.5 76q53.5 48.5 85 115T880-518q0 115-70 176.5T640-280h-74q-9 0-12.5 5t-3.5 11q0 12 15 34.5t15 51.5q0 50-27.5 74T480-80Zm0-400Zm-177 23q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120-160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm200 0q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120 160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17ZM480-160q9 0 14.5-5t5.5-13q0-14-15-33t-15-57q0-42 29-67t71-25h70q66 0 113-38.5T800-518q0-121-92.5-201.5T488-800q-136 0-232 93t-96 227q0 133 93.5 226.5T480-160Z"/></svg>`;

          case 'layout':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="m644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z"/></svg>`;

          case 'browser':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M324-111.5Q251-143 197-197t-85.5-127Q80-397 80-480t31.5-156Q143-709 197-763t127-85.5Q397-880 480-880t156 31.5Q709-817 763-763t85.5 127Q880-563 880-480t-31.5 156Q817-251 763-197t-127 85.5Q563-80 480-80t-156-31.5ZM440-162v-78q-33 0-56.5-23.5T360-320v-40L168-552q-3 18-5.5 36t-2.5 36q0 121 79.5 212T440-162Zm276-102q41-45 62.5-100.5T800-480q0-98-54.5-179T600-776v16q0 33-23.5 56.5T520-680h-80v80q0 17-11.5 28.5T400-560h-80v80h240q17 0 28.5 11.5T600-440v120h40q26 0 47 15.5t29 40.5Z"/></svg>`;

          case 'launching':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="m226-559 78 33q14-28 29-54t33-52l-56-11-84 84Zm142 83 114 113q42-16 90-49t90-75q70-70 109.5-155.5T806-800q-72-5-158 34.5T492-656q-42 42-75 90t-49 90Zm155-121.5q0-33.5 23-56.5t57-23q34 0 57 23t23 56.5q0 33.5-23 56.5t-57 23q-34 0-57-23t-23-56.5ZM565-220l84-84-11-56q-26 18-52 32.5T532-299l33 79Zm313-653q19 121-23.5 235.5T708-419l20 99q4 20-2 39t-20 33L538-80l-84-197-171-171-197-84 167-168q14-14 33.5-20t39.5-2l99 20q104-104 218-147t235-24ZM157-321q35-35 85.5-35.5T328-322q35 35 34.5 85.5T327-151q-25 25-83.5 43T82-76q14-103 32-161.5t43-83.5Zm57 56q-10 10-20 36.5T180-175q27-4 53.5-13.5T270-208q12-12 13-29t-11-29q-12-12-29-11.5T214-265Z"/></svg>`;

          case 'about':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M440-280h80v-240h-80v240Zm68.5-331.5Q520-623 520-640t-11.5-28.5Q497-680 480-680t-28.5 11.5Q440-657 440-640t11.5 28.5Q463-600 480-600t28.5-11.5ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;

          case 'help':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M513.5-254.5Q528-269 528-290t-14.5-35.5Q499-340 478-340t-35.5 14.5Q428-311 428-290t14.5 35.5Q457-240 478-240t35.5-14.5ZM442-394h74q0-33 7.5-52t42.5-52q26-26 41-49.5t15-56.5q0-56-41-86t-97-30q-57 0-92.5 30T342-618l66 26q5-18 22.5-39t53.5-21q32 0 48 17.5t16 38.5q0 20-12 37.5T506-526q-44 39-54 59t-10 73Zm38 314q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;

          case 'performance':
            return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M200-246q54-53 125.5-83.5T480-360q83 0 154.5 30.5T760-246v-514H200v514Zm379-235q41-41 41-99t-41-99q-41-41-99-41t-99 41q-41 41-41 99t41 99q41 41 99 41t99-41ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm69-80h422q-44-39-99.5-59.5T480-280q-56 0-112.5 20.5T269-200Zm168.5-337.5Q420-555 420-580t17.5-42.5Q455-640 480-640t42.5 17.5Q540-605 540-580t-17.5 42.5Q505-520 480-520t-42.5-17.5ZM480-503Z"/></svg>`;

          default:
            return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor"><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 32.5-156t88-127Q256-817 330-848.5T488-880q80 0 151 27.5t124.5 76q53.5 48.5 85 115T880-518q0 115-70 176.5T640-280h-74q-9 0-12.5 5t-3.5 11q0 12 15 34.5t15 51.5q0 50-27.5 74T480-80Zm0-400Zm-177 23q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120-160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm200 0q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120 160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17ZM480-160q9 0 14.5-5t5.5-13q0-14-15-33t-15-57q0-42 29-67t71-25h70q66 0 113-38.5T800-518q0-121-92.5-201.5T488-800q-136 0-232 93t-96 227q0 133 93.5 226.5T480-160Z"/></svg>`;
        }
      };

      const navItem = (id, label, hint) => `
        <button
          type="button"
          class="settings-nav-item ${settingsPanel === id ? 'active' : ''}"
          data-panel="${id}"
          onclick="switchSettingsPanel('${id}')"
          aria-current="${settingsPanel === id ? 'true' : 'false'}">
          <span class="settings-nav-left">
            <span class="settings-nav-icon" aria-hidden="true">${settingsNavIconHTML(id)}</span>
            <span class="settings-nav-label">${label}</span>
          </span>
        </button>
      `;

      return `
        <div class="settings-page">
          <div class="settings-window">
            <div class="settings-window-header">
              <h2>Orbit Settings</h2>
            </div>
            <div class="settings-window-body">
              <nav class="settings-sidebar">
                ${navItem('audio', 'Audio', 'Background Music and Volume controls')}
                ${navItem('appearance', 'Visuals', 'Colors, glow, particles, and background atmosphere')}
                ${navItem('layout', 'Cloaking', 'Tab cloaking and privacy settings')}
                ${navItem('launching', 'Launching', 'Game and browser launch behavior')}
                ${navItem('browser', 'Browser', 'Browser launch and behavior')}
                ${navItem('performance', 'Account', 'User profile and identity settings')}
                ${navItem('about', 'About & Statistics', 'Version, data, and reset')}
                ${navItem('help', 'Help', 'FAQ, quick start, and troubleshooting')}

              </nav>
              <div class="settings-panels">
                ${audioPanel}
                ${appearancePanel}
                ${layoutPanel}
                ${launchingPanel}
                ${browserPanel}
                ${performancePanel}
                ${aboutPanel}
                ${helpPanel}
              </div>
            </div>
          </div>
        </div>
      `;
    }


    function switchSettingsPanel(id) {
      settingsPanel = id;
      saveStoredSettings();
      document.querySelectorAll('.settings-nav-item').forEach(btn => {
        const active = btn.dataset.panel === id;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-current', active ? 'true' : 'false');
      });
      document.querySelectorAll('.settings-panel').forEach(panel => {
        panel.classList.toggle('active', panel.dataset.panel === id);
      });
    }

    function render(section, query = '') {
      currentSection = section;
      if (section !== null) heroSearchWidthInitialized = false;
      if (section === 'games' || section === 'tools' || section === 'apps') {
        lastBrowseQuery = query;
      }
      updateCustomScrollbar();

      // Show loading spinner on first games page load
      if (section === 'games' && firstGamesPageLoad) {
        const gamesLoadingOverlay = document.getElementById('gamesPageLoadingOverlay');
        if (gamesLoadingOverlay) {
          gamesLoadingOverlay.classList.remove('hidden');
        }
        // Hide main content while loading
        mainContent.style.visibility = 'hidden';
      }

      // Delayed update to ensure proper sizing after content loads (only for games)
      if (section === 'games') {
        setTimeout(() => {
          if (currentSection === 'games') {
            updateCustomScrollbar();
          }
        }, 100);
        setTimeout(() => {
          if (currentSection === 'games') {
            updateCustomScrollbar();
          }
        }, 300);
      }

      const isFullPage = fullPageSections.includes(section);

      heroSection.style.display = isFullPage ? 'none' : '';
      document.body.classList.remove('on-homepage');

      let html = '';
      if (section === 'settings') {
        html = buildSettingsHTML();
      } else if (section === 'info') {
        html = buildInfoHTML();
      } else {
        html = buildGamesHTML(section, query);
      }

      mainContent.innerHTML = html;
      setActiveNav(section);
      attachHoverSFX();
      updateTabCloakState();
      if (section === 'settings') {
        updateLaunchModeVisibility();
      }

      // Hide loading spinner when game icons are loaded (only for first games page load)
      if (section === 'games' && firstGamesPageLoad) {
        const gameImages = mainContent.querySelectorAll('.game-card img');
        let loadedCount = 0;
        const totalImages = gameImages.length;

        if (totalImages === 0) {
          // No images to load, hide spinner immediately
          const gamesLoadingOverlay = document.getElementById('gamesPageLoadingOverlay');
          if (gamesLoadingOverlay) {
            gamesLoadingOverlay.classList.add('hidden');
          }
          mainContent.style.visibility = 'visible';
          firstGamesPageLoad = false;
        } else {
          gameImages.forEach(img => {
            if (img.complete) {
              loadedCount++;
            } else {
              img.onload = () => {
                loadedCount++;
                if (loadedCount === totalImages) {
                  const gamesLoadingOverlay = document.getElementById('gamesPageLoadingOverlay');
                  if (gamesLoadingOverlay) {
                    gamesLoadingOverlay.classList.add('hidden');
                  }
                  mainContent.style.visibility = 'visible';
                  firstGamesPageLoad = false;
                }
              };
              img.onerror = () => {
                loadedCount++;
                if (loadedCount === totalImages) {
                  const gamesLoadingOverlay = document.getElementById('gamesPageLoadingOverlay');
                  if (gamesLoadingOverlay) {
                    gamesLoadingOverlay.classList.add('hidden');
                  }
                  mainContent.style.visibility = 'visible';
                  firstGamesPageLoad = false;
                }
              };
            }
          });

          // Check if all images are already loaded
          if (loadedCount === totalImages) {
            const gamesLoadingOverlay = document.getElementById('gamesPageLoadingOverlay');
            if (gamesLoadingOverlay) {
              gamesLoadingOverlay.classList.add('hidden');
            }
            mainContent.style.visibility = 'visible';
            firstGamesPageLoad = false;
          }
        }
      }

      // Trigger page animation
      requestAnimationFrame(() => {
        mainContent.style.animation = 'none';
        mainContent.offsetHeight; // Trigger reflow
        mainContent.style.animation = 'pageFadeIn 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
      });

      requestAnimationFrame(syncLayout);
    }

    function loadSection(section) {
      if (section === 'browser') {
        loadBrowserPage();
        return;
      }
      render(section);
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    }

    function captureBrowseState(section) {
      returnSection = section;
      const searchInput = document.getElementById('searchInput');
      lastBrowseQuery = searchInput ? searchInput.value : '';
    }

    // ── Single source of truth for game launch URL ──────────────────
    function resolveGameLaunchURL(game) {
      if (!game) return '';
      if (game.local === true) {
        console.log('[GAME-LAUNCH] local game detected:', game.id, '→', '/games/' + game.id + '/');
        return '/games/' + game.id + '/';
      }
      console.log('[GAME-LAUNCH] remote game:', game.id, '→', game.url);
      return game.url;
    }

    async function openGame(id) {
      const game = gameIndex[id];
      if (!game) return;
      const isLocalGame = game.local === true;
      const launchUrl = resolveGameLaunchURL(game);

      captureBrowseState('games');
      currentSection = 'game';
      fadeMusicOutForGame();
      heroSection.style.display = 'none';
      mainContent.innerHTML = buildGamePage(id);
      updateBatteryStatus();
      setActiveNav('games');
      attachHoverSFX();
      updateTabCloakState();
      maybeAutoLaunchExternal(launchUrl, game.title);
      // Hide sidebar on game pages
      document.body.classList.add('game-page-active');
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
      requestAnimationFrame(syncLayout);
      updateCustomScrollbar();

      // No fade-in for game page — fullscreen black overlay covers immediately
      mainContent.style.animation = 'none';
      mainContent.style.opacity = '1';
      mainContent.style.transform = 'none';

      // Load iframe src from data-src for obfuscation
      const iframe = document.getElementById('gameFrame');
      const loadingOverlay = document.getElementById('gameLoadingOverlay');
      if (!iframe) return;
      const src = iframe.getAttribute('data-src');
      if (!src) return;

      // Show loading overlay
      if (loadingOverlay) {
        loadingOverlay.classList.remove('hidden');
      }

      function doLoadGame(gameMode) {
        var gameSrc = launchUrl;

        if (!isLocalGame) {
          if (gameMode === 'proxy' && typeof window.encodeUVUrl === 'function') {
            var encoded = window.encodeUVUrl(launchUrl);
            console.log('[GAME-LAUNCH] encoded for proxy:', launchUrl, '→', encoded);
            gameSrc = encoded;
          } else {
            console.log('[GAME-LAUNCH] direct launch:', launchUrl, '(mode:', gameMode + ')');
          }
        } else {
          console.log('[GAME-LAUNCH] embedded launch URL:', gameSrc);
        }

        iframe.src = gameSrc;
        iframe.removeAttribute('data-src');

        var hideOverlay = function() {
          if (loadingOverlay) {
            loadingOverlay.classList.add('hidden');
          }
        };

        // Timer: 30-second content monitor for blank/error detection
        var gameLoadTimer = setTimeout(function gameLoadMonitor() {
          if (loadingOverlay && loadingOverlay.classList.contains('hidden')) {
            console.log('[GAME-MONITOR] game already loaded, skipping blank check');
            return;
          }
          try {
            var d = iframe.contentDocument;
            if (!d || !d.body) {
              console.warn('[GAME-MONITOR] no content document detected');
              showGameError('Game failed to load (no content)');
              return;
            }
            var txt = d.body.innerText || '';
            if (txt.trim().length === 0) {
              console.warn('[GAME-MONITOR] blank page detected');
              showGameError('Game failed to load (blank page)');
            }
          } catch(e) {
            if (e.message && e.message.includes('cross-origin')) {
              console.log('[GAME-MONITOR] cross-origin iframe, skipping blank check');
            } else {
              console.warn('[GAME-MONITOR] unexpected error:', e.message);
              showGameError('Game failed to load (' + e.message + ')');
            }
          }
        }, 30000);

        // On successful iframe load, clear the error monitor and hide overlay
        iframe.onload = function() {
          console.log('[GAME-MONITOR] iframe loaded successfully, clearing error timer');
          clearTimeout(gameLoadTimer);
          hideOverlay();
        };

        // Fallback: hide loading overlay after 5 seconds
        setTimeout(function() {
          hideOverlay();
        }, 5000);
      }

      function showGameError(msg) {
        if (loadingOverlay) {
          loadingOverlay.innerHTML = '<div class="game-loading-error"><svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg><p>' + escapeHTML(msg) + '</p><button onclick="document.getElementById(\'gameLoadingOverlay\').classList.add(\'hidden\');document.getElementById(\'gameLoadingOverlay\').innerHTML=\'\';openGame(\'' + id + '\')" class="game-error-retry">Retry</button></div>';
          loadingOverlay.classList.remove('hidden');
        }
      }

      // Determine game mode and load
      if (isLocalGame) {
        doLoadGame('direct');
      } else {
        // Helper: wait for portReady then load in proxy mode
        function loadWithProxy() {
          var portReady = window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady === true;
          if (portReady) {
            doLoadGame('proxy');
          } else {
            console.log('[GAME-DEFER] waiting for portReady before loading game:', id, 'at', Date.now());
            var pollInterval = setInterval(function() {
              var ready = window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady === true;
              if (ready) {
                clearInterval(pollInterval);
                console.log('[GAME-DEFER] portReady, loading game:', id, 'at', Date.now());
                doLoadGame('proxy');
              }
            }, 100);
            setTimeout(function() {
              clearInterval(pollInterval);
              if (iframe && !iframe.src) {
                console.warn('[GAME-DEFER] timeout waiting for portReady, showing error');
                if (loadingOverlay) {
                  loadingOverlay.innerHTML = '<div class="game-loading-error"><svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg><p>Failed to load game. The proxy connection timed out.</p><button onclick="openGame(\'' + id + '\')" class="game-error-retry">Retry</button></div>';
                }
              }
            }, 15000);
          }
        }

        // Detect game compatibility mode before loading
        try {
          var compat = await window.detectGameMode(game.id, launchUrl);
          var compatMode = compat.mode;
          var compatReason = compat.reason;
          console.log('[GAME MODE] ' + compatMode + ' (' + compatReason + ')');

          if (compatMode === 'direct') {
            doLoadGame('direct');
          } else {
            loadWithProxy();
          }
        } catch (e) {
          console.warn('[GAME-COMPAT] error detecting game mode, defaulting to proxy:', e.message);
          loadWithProxy();
        }
      }
    }

    function backFromPlayer() {
      render(returnSection, lastBrowseQuery);
      heroSection.style.display = 'none';
      setActiveNav(returnSection);
      attachHoverSFX();
      updateTabCloakState();
      // Show sidebar again when leaving game page
      document.body.classList.remove('game-page-active');
      fadeMusicInAfterGame();
      window.scrollTo({ top: 0, behavior: 'auto' });
      requestAnimationFrame(syncLayout);
      updateCustomScrollbar();
    }

    function handleCardKey(event, id, section = 'games') {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openGame(id);
      }
    }

    function fullscreenFrame() {
      const frameWrap = document.getElementById('gameFrameWrap');
      const frame = document.getElementById('gameFrame');
      const target = frameWrap || frame;

      if (target && target.requestFullscreen) {
        target.requestFullscreen().catch(() => {});
      }
    }

    function openGameTab() {
      var iframe = document.getElementById('gameFrame');
      if (!iframe || !iframe.src) return;
      console.log('[GAME-LAUNCH] Open in New Tab: iframe.src =', iframe.src);
      window.open(iframe.src, '_blank', 'noopener,noreferrer');
    }

    function refreshGame() {
      const iframe = document.getElementById('gameFrame');
      if (iframe) {
        const currentSrc = iframe.src;
        iframe.src = '';
        setTimeout(() => {
          iframe.src = currentSrc;
        }, 10);
      }
    }

    let gameNotchStateTimer = null;

    function toggleGameNotch() {
      const notch = document.getElementById('gameNotch');
      const toggle = document.getElementById('gameNotchToggle');
      if (!notch || !toggle) return;
      const arrowUp = toggle.querySelector('.notch-arrow-up');
      const arrowDown = toggle.querySelector('.notch-arrow-down');

      if (gameNotchStateTimer) {
        clearTimeout(gameNotchStateTimer);
        gameNotchStateTimer = null;
      }

      if (notch.classList.contains('minimized') || notch.classList.contains('minimizing')) {
        notch.classList.remove('minimized', 'minimizing');
        if (arrowUp) arrowUp.style.display = '';
        if (arrowDown) arrowDown.style.display = 'none';
      } else {
        notch.classList.add('minimizing');
        if (arrowUp) arrowUp.style.display = 'none';
        if (arrowDown) arrowDown.style.display = '';
        gameNotchStateTimer = setTimeout(() => {
          notch.classList.remove('minimizing');
          notch.classList.add('minimized');
          gameNotchStateTimer = null;
        }, 2500);
      }
    }

    function updateGameNotchTime() {
      const timeElement = document.getElementById('gameNotchTime');
      if (!timeElement) return;
      
      const now = new Date();
      const timeString = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      timeElement.textContent = timeString;
    }

    let gameBatteryBound = false;
    let gameBatteryManager = null;

    function renderGameBattery(battery) {
      const batteryElement = document.getElementById('gameNotchBattery');
      if (!batteryElement) return;

      const batteryIcon = batteryElement.querySelector('.battery-icon');
      const chargingIcon = batteryElement.querySelector('.charging-icon');
      const batteryLevel = batteryIcon.querySelector('.battery-level');
      const level = battery ? battery.level : 1;
      const isCharging = battery ? battery.charging : false;

      batteryElement.style.display = '';
      batteryElement.classList.toggle('charging', isCharging);
      if (chargingIcon && !isCharging) chargingIcon.style.display = 'none';

      const maxWidth = 12;
      const newWidth = Math.max(1, Math.round(level * maxWidth));
      batteryLevel.setAttribute('width', newWidth.toString());

      if (level <= 0.25) {
        batteryLevel.setAttribute('fill', 'rgba(255, 100, 100, 0.9)');
      } else if (level <= 0.5) {
        batteryLevel.setAttribute('fill', 'rgba(255, 200, 100, 0.9)');
      } else {
        batteryLevel.setAttribute('fill', 'rgba(255, 255, 255, 0.7)');
      }
    }

    function updateBatteryStatus() {
      if (!('getBattery' in navigator)) {
        renderGameBattery(null);
        return;
      }

      if (gameBatteryManager) {
        renderGameBattery(gameBatteryManager);
        return;
      }

      if (gameBatteryBound) return;
      gameBatteryBound = true;
      navigator.getBattery().then(function(battery) {
        gameBatteryManager = battery;
        const updateBattery = () => renderGameBattery(battery);
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
      }).catch(function() {
        renderGameBattery(null);
      });
    }

    setInterval(updateGameNotchTime, 1000);
    updateGameNotchTime();
    updateBatteryStatus();

    // Custom Scrollbar Functionality
    const customScrollbar = document.getElementById('customScrollbar');
    const customScrollbarThumb = customScrollbar?.querySelector('.custom-scrollbar-thumb');
    let isDragging = false;
    let startY = 0;
    let startScrollTop = 0;

    function shouldShowScrollbar() {
      // Only show scrollbar on games section
      return currentSection === 'games';
    }

    function updateCustomScrollbar() {
      if (!customScrollbar || !customScrollbarThumb) return;

      if (!shouldShowScrollbar()) {
        customScrollbar.style.display = 'none';
        customScrollbar.style.opacity = '0';
        customScrollbar.style.visibility = 'hidden';
        customScrollbarThumb.style.height = '0px';
        customScrollbarThumb.style.top = '0px';
        customScrollbarThumb.style.opacity = '0';
        return;
      }

      customScrollbar.style.display = 'block';
      customScrollbar.style.opacity = '1';
      customScrollbar.style.visibility = 'visible';
      customScrollbarThumb.style.opacity = '1';

      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      const scrollPercent = scrollTop / (scrollHeight - clientHeight);
      const thumbHeight = Math.max(30, (clientHeight / scrollHeight) * clientHeight);
      const thumbTop = scrollPercent * (clientHeight - thumbHeight);

      customScrollbarThumb.style.height = `${thumbHeight}px`;
      customScrollbarThumb.style.top = `${thumbTop}px`;
    }

    function handleScroll() {
      if (!shouldShowScrollbar()) {
        if (customScrollbar) {
          customScrollbar.style.display = 'none';
        }
        return;
      }
      updateCustomScrollbar();
    }

    function handleDragStart(e) {
      isDragging = true;
      startY = e.clientY;
      startScrollTop = window.pageYOffset || document.documentElement.scrollTop;
      document.body.style.userSelect = 'none';
    }

    function handleDragMove(e) {
      if (!isDragging) return;

      const deltaY = e.clientY - startY;
      const scrollHeight = document.documentElement.scrollHeight;
      const clientHeight = window.innerHeight;
      const scrollRatio = deltaY / clientHeight;
      const newScrollTop = startScrollTop + (scrollRatio * (scrollHeight - clientHeight) * 2);

      window.scrollTo(0, newScrollTop);
    }

    function handleDragEnd() {
      isDragging = false;
      document.body.style.userSelect = '';
    }

    // Initialize custom scrollbar
    if (customScrollbar && customScrollbarThumb) {
      window.addEventListener('scroll', handleScroll);
      window.addEventListener('resize', () => {
        if (!shouldShowScrollbar()) {
          customScrollbar.style.display = 'none';
          return;
        }
        updateCustomScrollbar();
      });
      customScrollbarThumb.addEventListener('mousedown', handleDragStart);
      window.addEventListener('mousemove', handleDragMove);
      window.addEventListener('mouseup', handleDragEnd);

      // Initial update
      updateCustomScrollbar();
    }

    function openProxyTab() {}

    function openProxyBlankTab() {}

    function setActiveNav(section) {
      document.querySelectorAll('.nav-icon').forEach(el => {
        el.classList.toggle('active', el.dataset.section === section);
      });
    }

    function clearHomeSearch() {
      homeSearchInput.value = '';
      homeSearchResults.classList.remove('active');
      homeSearchResults.innerHTML = '';
    }

    function handleHomeSearch(query) {
      const value = query.trim().toLowerCase();

      if (!value) {
        homeSearchStack.classList.remove('searching');
        homeSearchResults.classList.remove('active');
        homeSearchResults.innerHTML = '';
        return;
      }

      const groups = Object.entries(searchPages).map(([section, page]) => {
        const matches = page.items.filter(item => {
          const haystack = `${item.title} ${item.desc} ${item.badge} ${page.label}`.toLowerCase();
          return haystack.includes(value);
        });

        return { section, label: page.label, matches };
      }).filter(group => group.matches.length > 0);

      homeSearchResults.classList.add('active');

      if (!groups.length) {
        homeSearchResults.innerHTML = `
          <div class="home-search-empty">No matching games, tools, apps, or pages found.</div>
        `;
        return;
      }

      homeSearchResults.innerHTML = `
        <div class="home-search-inner">
          ${groups.map(group => `
            <div class="home-search-section">
              <div class="home-search-heading">
                <span>${escapeHTML(group.label)}</span>
                <span>${group.matches.length} result${group.matches.length === 1 ? '' : 's'}</span>
              </div>
              ${group.matches.map(item => `
                <button class="home-search-item" data-section="${escapeHTML(group.section)}" data-title="${escapeHTML(item.title)}" onclick="openSearchResult(this.dataset.section, this.dataset.title)">
                  <div class="home-search-icon">
                    ${item.image ? `<img src="${escapeHTML(item.image)}" alt="${escapeHTML(item.title)} icon">` : item.emoji}
                  </div>
                  <div class="home-search-copy">
                    <strong>${escapeHTML(item.title)}</strong>
                    <p>${escapeHTML(item.desc)}</p>
                  </div>
                </button>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `;

      attachHoverSFX();
    }

    function openSearchResult(section, title) {
      const match = (sectionData[section] || []).find(item => item.title === title);

      if (match && match.url && match.id) {
        openGame(match.id);
        return;
      }

      loadSection(section);

      requestAnimationFrame(() => {
        const searchInput = document.getElementById('searchInput');
        if (searchInput && section !== 'info') {
          searchInput.value = title;
          handleSearch(title);
        }
      });
    }

    function handleSearch(query) {
      if (currentSection && !['settings', 'info', 'game', 'proxy'].includes(currentSection)) {
        const grid = document.getElementById('gamesGrid');
        if (!grid) return;
        const items = (sectionData[currentSection] || [])
          .filter(i => i.title.toLowerCase().includes(query.toLowerCase()));
        grid.innerHTML = buildGameCards(items, currentSection);
        attachHoverSFX();
      }
    }

    function loadBrowserPage() {
      captureBrowseState('browser');
      currentSection = 'browser';
      document.body.classList.remove('on-homepage');
      heroSection.style.display = 'none';
      mainContent.innerHTML = '<div id="browserMount"></div>';
      setActiveNav('browser');
      attachHoverSFX();
      updateTabCloakState();
      window.scrollTo({ top: 0, behavior: 'auto' });
      const pendingQuery = window.__pendingHomeSearch;
      window.__pendingHomeSearch = null;
      requestAnimationFrame(() => {
        const mount = document.getElementById('browserMount');
        if (mount && window.VoltraBrowser) {
          VoltraBrowser.render(mount);
          if (pendingQuery) {
            setTimeout(() => {
              VoltraBrowser.navigate(pendingQuery);
            }, 50);
          }
        }
      });
      updateCustomScrollbar();

      // Trigger page animation
      requestAnimationFrame(() => {
        mainContent.style.animation = 'none';
        mainContent.offsetHeight; // Trigger reflow
        mainContent.style.animation = 'pageFadeIn 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
      });
    }

    function goHome() {
      heroSection.style.display = '';
      const heroBrand = document.querySelector('.hero-brand');
      if (heroBrand) {
        heroBrand.style.opacity = '0';
        requestAnimationFrame(() => {
          heroBrand.style.transition = 'opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
          heroBrand.style.opacity = '1';
        });
      }
      resetHeroSearchBar();
      updateHeroEngineIcon();
      closeHeroEngineMenu();
      mainContent.innerHTML = '';
      currentSection = null;
      setActiveNav('home');
      document.body.classList.add('on-homepage');
      clearHomeSearch();
      updateTabCloakState();
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
      // Force hide scrollbar immediately and ensure it stays hidden
      if (customScrollbar) {
        customScrollbar.style.display = 'none';
        customScrollbar.style.opacity = '0';
        customScrollbar.style.visibility = 'hidden';
      }
      if (customScrollbarThumb) {
        customScrollbarThumb.style.opacity = '0';
      }

      // Trigger page animation
      requestAnimationFrame(() => {
        mainContent.style.animation = 'none';
        mainContent.offsetHeight; // Trigger reflow
        mainContent.style.animation = 'pageFadeIn 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
      });
    }

    function resetHeroSearchBar({ entrance = false } = {}) {
      const heroSearchBar = document.getElementById('heroSearchBar');
      if (!heroSearchBar) return;

      heroSearchBar.classList.remove('hover-active', 'hover-delay', 'hero-search-ready', 'hero-search-enter');
      heroSearchBar.classList.add('hero-search-resetting');
      heroSearchBar.style.removeProperty('transition');
      heroSearchBar.style.removeProperty('opacity');
      heroSearchBar.style.removeProperty('transform');
      heroSearchBar.style.removeProperty('box-shadow');
      heroSearchBar.style.removeProperty('width');
      void heroSearchBar.offsetWidth;

      if (entrance) {
        heroSearchBar.classList.add('hero-search-enter');
      }

      requestAnimationFrame(() => {
        heroSearchBar.classList.remove('hero-search-resetting');

        if (!entrance) {
          heroSearchBar.classList.add('hero-search-ready');
          return;
        }

        let finished = false;
        const finishEntrance = () => {
          if (finished) return;
          finished = true;
          heroSearchBar.classList.remove('hero-search-enter');
          heroSearchBar.classList.add('hero-search-ready');
        };

        heroSearchBar.addEventListener('animationend', finishEntrance, { once: true });
        setTimeout(finishEntrance, 900);
      });
    }

    function applySettings() {
      const root = document.documentElement;
      let theme = accentThemes[settings.accent];
      if (!theme) {
        theme = accentThemes.snow;
        settings.accent = 'snow';
      }
      const glowLevel = settings.glow / 100;
      const targetParticles = settings.particles ? particleDensityMap[settings.particleDensity] : 0;

      root.style.setProperty('--accent-a', theme.a);
      root.style.setProperty('--accent-b', theme.b);
      root.style.setProperty('--accent-c', theme.c);
      root.style.setProperty('--theme-a', theme.a);
      root.style.setProperty('--theme-b', theme.b);
      root.style.setProperty('--theme-c', theme.c);
      root.style.setProperty('--bg-glow-a', (0.15 * glowLevel).toFixed(3));
      root.style.setProperty('--bg-glow-b', (0.14 * glowLevel).toFixed(3));
      root.style.setProperty('--bg-glow-c', (0.08 * glowLevel).toFixed(3));
      root.style.setProperty('--glow-soft', (0.22 * glowLevel).toFixed(3));
      root.style.setProperty('--glow-medium', (0.16 * glowLevel).toFixed(3));
      root.style.setProperty('--glow-strong', (0.55 * glowLevel).toFixed(3));
      root.style.setProperty('--glow-outline', (0.25 * glowLevel).toFixed(3));
      root.style.setProperty('--glow-card-a', (0.16 * glowLevel).toFixed(3));
      root.style.setProperty('--glow-card-b', (0.12 * glowLevel).toFixed(3));
      root.style.setProperty('--card-radius', settings.compactCards ? '18px' : '28px');
      root.style.setProperty('--thumb-radius', settings.compactCards ? '14px' : '20px');

      document.body.classList.toggle('reduced-motion', settings.reducedMotion);
      document.body.classList.toggle('compact-cards', settings.compactCards);
      document.body.classList.toggle('high-contrast', settings.highContrast);
      document.body.classList.toggle('hide-orbs', !settings.backgroundOrbs);
      document.body.classList.toggle('smooth-scroll', settings.smoothScroll);

      visualMotionReduced = settings.reducedMotion;
      music.volume = settings.musicVolume / 100;
      music.muted = !settings.music;
      window.__voltraSfxVolume = settings.sfx ? settings.sfxVolume / 100 : 0;

      canvas.style.opacity = settings.particles ? (settings.highContrast ? '0.68' : '0.9') : '0';

      while (particles.length < targetParticles) particles.push(new Particle());
      if (particles.length > targetParticles) particles.length = targetParticles;

      updateTabCloakState();
    }

    function onToggle(id, val) {
      settings[id] = val;

      if (id === 'autoExternalLaunch' || id === 'autoLaunchOnLoad') {
        updateLaunchModeVisibility();
      }

      if (id === 'autoLaunchOnLoad' && val === true) {
        const testPopup = window.open('', '_blank');
        if (!testPopup || testPopup.closed || typeof testPopup.closed == 'undefined') {
          alert('Please allow popups for this website to use Orbit Incognito. The about:blank tab will be blocked otherwise. Reload the page after enabling popups.');
        } else {
          testPopup.close();
          alert('Popups are now enabled. Reloading page...');
          setTimeout(() => location.reload(), 1000);
        }
      }

      saveStoredSettings();
      applySettings();
    }

    function onRange(id, val) {
      settings[id] = Number(val);
      const output = document.getElementById(`${id}-value`);
      if (output) output.textContent = formatSettingValue(id);
      saveStoredSettings();
      applySettings();
    }

    function onSelect(id, val) {
      settings[id] = val;
      saveStoredSettings();
      applySettings();
    }

    function onTextSetting(id, val) {
      settings[id] = val;
      saveStoredSettings();
      applySettings();
    }

    function setOption(id, val) {
      settings[id] = val;
      saveStoredSettings();
      applySettings();
      if (currentSection === 'settings') render('settings');
    }

    function isValidAudioUrl(str) {
      try {
        const url = new URL(str);
        return /\.(mp3|wav|ogg|aac|m4a|flac|webm)(\?.*)?$/i.test(url.pathname);
      } catch { return false; }
    }

    const bgMusicLabels = {
      orbit: 'Orbit (Default)',
      minecraft: 'Minecraft',
      zelda: 'Zelda',
      rapbeats: 'Rap Beats',
      custom: 'Custom',
    };

    function switchTrack(src) {
      const wasPlaying = !music.paused && !music.muted && settings.music;
      music.pause();
      music.src = src;
      music.load();
      if (wasPlaying) {
        music.play().catch(() => {});
      }
    }

    function selectBgMusic(value) {
      settings.bgMusic = value;
      saveStoredSettings();
      updateBgMusicUI(value);
      closeBgMusicDropdown();

      if (value === 'custom') {
        const url = settings.bgMusicCustomUrl;
        if (url && isValidAudioUrl(url)) {
          switchTrack(url);
        }
        showCustomUrlRow(value === 'custom');
      } else {
        const src = musicSources[value];
        if (src) {
          switchTrack(src);
        }
        showCustomUrlRow(false);
      }
    }

    function toggleBgMusicDropdown() {
      const el = document.querySelector('.settings-custom-select');
      if (!el) return;
      const open = el.classList.toggle('open');
      const trigger = el.querySelector('.settings-custom-select-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', open);
      if (open) {
        setTimeout(() => document.addEventListener('click', closeBgMusicDropdown), 10);
      } else {
        document.removeEventListener('click', closeBgMusicDropdown);
      }
    }

    function closeBgMusicDropdown(e) {
      const el = document.querySelector('.settings-custom-select');
      if (!el) return;
      if (e && e.target && el.contains(e.target)) return;
      el.classList.remove('open');
      const trigger = el.querySelector('.settings-custom-select-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('click', closeBgMusicDropdown);
    }

    function updateBgMusicUI(value) {
      const el = document.querySelector('.settings-custom-select');
      if (!el) return;
      const label = el.querySelector('.settings-custom-select-label');
      if (label) label.textContent = bgMusicLabels[value] || 'Orbit (Default)';
      el.querySelectorAll('.settings-custom-select-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.value === value);
      });
    }

    function onBgMusicCustomUrl(val) {
      settings.bgMusicCustomUrl = val;
      saveStoredSettings();
      if (settings.bgMusic === 'custom' && val && isValidAudioUrl(val)) {
        switchTrack(val);
      }
    }

    function showCustomUrlRow(show) {
      const row = document.getElementById('customMusicUrlRow');
      if (!row) return;
      if (show) {
        row.style.display = 'block';
        requestAnimationFrame(() => {
          row.style.maxHeight = row.scrollHeight + 'px';
          row.style.opacity = '1';
          row.style.marginBottom = '0';
        });
      } else {
        row.style.maxHeight = '0';
        row.style.opacity = '0';
        row.style.marginBottom = '0';
        setTimeout(() => { row.style.display = 'none'; }, 350);
      }
    }

    function resetBgMusic() {
      const orbitSrc = musicSources.orbit;
      if (orbitSrc && music.src !== orbitSrc) {
        music.src = orbitSrc;
        music.load();
      }
    }

    function resetSettings() {
      Object.assign(settings, defaultSettings);
      settingsPanel = 'audio';
      try {
        localStorage.removeItem(SETTINGS_STORAGE_KEY);
      } catch (err) {
        console.warn('Could not clear saved settings.', err);
      }
      resetBgMusic();
      applySettings();
      render('settings');
    }

    function wipeAllData() {
      if (confirm('Are you sure you want to wipe all saved data? This will reset everything as if you joined the website for the first time.')) {
        try {
          localStorage.clear();
          sessionStorage.clear();
          location.reload();
        } catch (err) {
          console.warn('Could not wipe all data.', err);
          alert('Could not wipe all data. Please try again.');
        }
      }
    }

    function attachHoverSFX() {
      document.querySelectorAll('.game-card, .info-feature, .settings-reset, .settings-nav-item, .home-search-item, .suggestion-card, .icon-btn, .proxy-open-btn').forEach(el => {
        if (!el.dataset.sfx) {
          el.dataset.sfx = "1";
          el.addEventListener('mouseenter', () => playHover(0.92));
        }
      });
    }

    document.querySelectorAll('.nav-icon').forEach(el => {
      el.addEventListener('mouseenter', () => playHover(1));
    });

    document.querySelectorAll('.hero-search, .hero-search-bar').forEach(el => {
      el.addEventListener('mouseenter', () => playHover(0.92));
    });

    applySettings();

    function updateLaunchModeVisibility() {
      const externalLaunchModeRow = document.getElementById('externalLaunchModeRow');
      
      if (externalLaunchModeRow) {
        const isVisible = settings.autoExternalLaunch;
        if (isVisible) {
          externalLaunchModeRow.style.display = 'block';
          externalLaunchModeRow.style.opacity = '0';
          externalLaunchModeRow.style.transform = 'translateY(-10px)';
          requestAnimationFrame(() => {
            externalLaunchModeRow.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            externalLaunchModeRow.style.opacity = '1';
            externalLaunchModeRow.style.transform = 'translateY(0)';
          });
        } else {
          externalLaunchModeRow.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
          externalLaunchModeRow.style.opacity = '0';
          externalLaunchModeRow.style.transform = 'translateY(-10px)';
          setTimeout(() => {
            if (!settings.autoExternalLaunch) {
              externalLaunchModeRow.style.display = 'none';
            }
          }, 200);
        }
      }
    }

    function handleAutoLaunchOnLoad() {
      if (settings.autoLaunchOnLoad) {
        const currentUrl = window.location.href;
        const newTab = window.open('about:blank', '_blank');
        if (newTab) {
          newTab.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Orbit</title>
              <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                html, body { width: 100%; height: 100%; overflow: hidden; }
                iframe { width: 100%; height: 100%; border: none; display: block; }
              </style>
            </head>
            <body>
              <iframe src="${currentUrl}" allowfullscreen></iframe>
            </body>
            </html>
          `);
          newTab.document.close();
          window.location.href = 'https://www.google.com';
        }
      }
    }

    handleAutoLaunchOnLoad();

    function checkPasswordProtection() {
      if (settings.requirePassword && settings.websitePassword) {
        const passwordOverlay = document.getElementById('passwordOverlay');
        const passwordInput = document.getElementById('passwordInput');
        const passwordError = document.getElementById('passwordError');
        const submitText = document.getElementById('passwordSubmitText');
        const submitBtn = document.getElementById('passwordSubmit');
        
        passwordOverlay.style.display = 'flex';
        passwordInput.value = '';
        passwordError.classList.remove('show', 'hide-error');
        passwordInput.classList.remove('input-error');
        submitText.textContent = 'Unlock';
        submitBtn.classList.remove('success');
        
        document.body.style.overflow = 'hidden';
        
        initPasswordClock();
        
        requestAnimationFrame(() => {
          passwordOverlay.classList.add('visible');
        });
        
        passwordInput.focus();
      } else {
        const introScreen = document.getElementById('introScreen');
        if (introScreen) introScreen.style.display = 'flex';
      }
    }

    function initPasswordClock() {
      const clockEl = document.getElementById('passwordClock');
      const dateEl = document.getElementById('passwordDate');
      if (!clockEl) return;
      
      const locale = navigator.language || 'en-US';
      const hourCycle = Intl.DateTimeFormat(locale).resolvedOptions().hourCycle || 'h12';
      const is24h = hourCycle === 'h23' || hourCycle === 'h24';
      const timeFormat = new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: is24h ? 'h23' : 'h12'
      });
      const dateFormat = new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      });
      
      function update() {
        const now = new Date();
        clockEl.textContent = timeFormat.format(now);
        if (dateEl) dateEl.textContent = dateFormat.format(now);
      }
      
      update();
      if (window._passwordClockInterval) clearInterval(window._passwordClockInterval);
      window._passwordClockInterval = setInterval(update, 1000);
    }

    function afterUnlock() {
      const passwordOverlay = document.getElementById('passwordOverlay');
      passwordOverlay.style.display = 'none';
      document.body.style.overflow = '';
      passwordOverlay.classList.remove('visible', 'unlocking');
      
      const submitText = document.getElementById('passwordSubmitText');
      const submitBtn = document.getElementById('passwordSubmit');
      if (submitText) submitText.textContent = 'Unlock';
      if (submitBtn) submitBtn.classList.remove('success');
      if (window._passwordClockInterval) {
        clearInterval(window._passwordClockInterval);
        window._passwordClockInterval = null;
      }
      
      if (window.__pendingOnboarding) {
        window.__pendingOnboarding = false;
        startOnboarding();
      } else {
        const introScreen = document.getElementById('introScreen');
        if (introScreen) introScreen.style.display = 'flex';
      }
    }

    function submitPassword() {
      const passwordInput = document.getElementById('passwordInput');
      const passwordError = document.getElementById('passwordError');
      const passwordOverlay = document.getElementById('passwordOverlay');
      const submitText = document.getElementById('passwordSubmitText');
      const submitBtn = document.getElementById('passwordSubmit');
      
      if (passwordInput.value === settings.websitePassword) {
        submitText.textContent = 'Unlocked';
        submitBtn.classList.add('success');
        setTimeout(() => {
          passwordOverlay.classList.add('unlocking');
          setTimeout(() => {
            afterUnlock();
          }, 800);
        }, 400);
      } else {
        passwordInput.classList.add('input-error');
        passwordError.classList.remove('hide-error');
        passwordError.classList.add('show');
        passwordInput.value = '';
        passwordInput.focus();
        setTimeout(() => {
          passwordInput.classList.remove('input-error');
          passwordError.classList.add('hide-error');
        }, 2500);
      }
    }

    document.addEventListener('keydown', (e) => {
      if (settings.requirePassword && settings.websitePassword && settings.bypassKeybind) {
        const passwordOverlay = document.getElementById('passwordOverlay');
        if (passwordOverlay && passwordOverlay.style.display === 'flex') {
          if (e.shiftKey && e.key.toUpperCase() === settings.bypassKeybind.toUpperCase()) {
            afterUnlock();
          }
        }
      }
    });

    document.addEventListener('DOMContentLoaded', () => {
      const passwordInput = document.getElementById('passwordInput');
      if (passwordInput) {
        passwordInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            submitPassword();
          }
        });
      }
    });

    window.submitPassword = submitPassword;
    window.checkPasswordProtection = checkPasswordProtection;

    checkPasswordProtection();

    document.addEventListener('visibilitychange', () => {
      if (settings.autoTabCloak) {
        if (document.hidden) applyTabCloak();
        else restoreTabIdentity();
      }
    });

    // ============================================================
    // ONBOARDING FLOW
    // ============================================================
    let onboardingStep = 0;
    let onboardingUsername = '';
    let onboardingTheme = settings.accent || 'snow';
    let onboardingAudioEnabled = false;
    let audioEnabledDuringOnboarding = false;
    let originalHoverSFX = false;
    let originalInterfaceSFX = false;

    function checkOnboarding() {
      const onboardingCompleted = localStorage.getItem('onboardingCompleted');
      return onboardingCompleted !== 'true';
    }

    function startOnboarding() {
      const onboardingFlow = document.getElementById('onboardingFlow');
      const introScreen = document.getElementById('introScreen');

      if (onboardingFlow && introScreen) {
        introScreen.style.display = 'none';
        onboardingFlow.style.display = 'flex';
        
        // Store original audio settings and disable audio during onboarding
        originalHoverSFX = settings.hoverSFX;
        originalInterfaceSFX = settings.interfaceSFX;
        audioEnabledDuringOnboarding = false;
        settings.hoverSFX = false;
        settings.interfaceSFX = false;
        
        showOnboardingStep(1);
      }
    }

    function initializeIntro() {
      if (settings.requirePassword && settings.websitePassword) {
        window.__pendingOnboarding = checkOnboarding();
        return;
      }

      const introScreen = document.getElementById('introScreen');
      const enterButton = document.getElementById('enterButton');

      if (checkOnboarding()) {
        // First-time user: skip intro entirely, start onboarding immediately
        if (introScreen) {
          introScreen.style.display = 'none';
        }
        startOnboarding();
      }
      // Returning users: use existing intro behavior (no changes needed)
    }

    function showOnboardingStep(step) {
      const steps = document.querySelectorAll('.onboarding-step');
      steps.forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
      });

      const currentStep = document.getElementById(`onboardingStep${step}`);
      if (currentStep) {
        currentStep.style.display = 'flex';
        setTimeout(() => currentStep.classList.add('active'), 10);
        onboardingStep = step;

        if (step === 1) {
          setTimeout(() => animateLogoLetters(), 400);
          // Hide button initially; fade in after Orbit finishes forming
          const getStartedBtn = document.getElementById('getStartedBtn');
          if (getStartedBtn) {
            getStartedBtn.style.transition = 'none';
            getStartedBtn.style.opacity = '0';
            void getStartedBtn.offsetHeight;
            setTimeout(() => {
              getStartedBtn.style.transition = '';
              requestAnimationFrame(() => {
                getStartedBtn.style.opacity = '1';
              });
            }, 2100);
            // One-shot particle burst on enter; re-triggers on re-enter after leave
            let armed = true;
            getStartedBtn.addEventListener('mouseenter', function once() {
              if (!armed) return;
              emitButtonParticles(getStartedBtn);
              armed = false;
            });
            getStartedBtn.addEventListener('mouseleave', function rearm() {
              armed = true;
            });
          }
        } else if (step === 3) {
          populateThemeCards();
        } else if (step === 5) {
          const welcomeMessage = document.getElementById('welcomeMessage');
          if (welcomeMessage && onboardingUsername) {
            welcomeMessage.textContent = `Welcome, ${onboardingUsername}!`;
          }
          // Auto-transition to complete onboarding after showing welcome
          setTimeout(() => {
            completeOnboarding();
          }, 4000);
        }
      }
    }

    function emitButtonParticles(btn) {
      const rect = btn.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const cx = w / 2;
      const cy = h / 2;

      const pCount = 10 + Math.floor(Math.random() * 7);
      const perEdge = [0, 0, 0, 0];
      for (let e = 0; e < 4; e++) perEdge[e] = Math.floor(pCount / 4);
      for (let r = 0; r < pCount - perEdge[0] * 4; r++) perEdge[r]++;

      const edgeOrder = [0, 1, 2, 3];
      for (let i = 3; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = edgeOrder[i]; edgeOrder[i] = edgeOrder[j]; edgeOrder[j] = tmp;
      }

      const particles = [];

      for (let e = 0; e < 4; e++) {
        const edge = edgeOrder[e];
        for (let n = 0; n < perEdge[e]; n++) {
          let px, py;
          switch (edge) {
            case 0: px = Math.random() * w; py = 0; break;
            case 1: px = w; py = Math.random() * h; break;
            case 2: px = Math.random() * w; py = h; break;
            case 3: px = 0; py = Math.random() * h; break;
          }

          let dx = px - cx;
          let dy = py - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) continue;
          dx /= dist;
          dy /= dist;

          const angle = Math.atan2(dy, dx);
          const spread = (Math.random() - 0.5) * Math.PI * 0.3;
          const finalAngle = angle + spread;
          const vx = Math.cos(finalAngle);
          const vy = Math.sin(finalAngle);

          const travelDist = 14 + Math.random() * 24;
          const duration = 550 + Math.random() * 300;
          const size = 5 + Math.random() * 6;
          const isRing = Math.random() > 0.85;

          let displaySize, bgStyle;
          if (isRing) {
            displaySize = size + 1 + Math.random() * 2;
            bgStyle = 'border:1px solid rgba(255,255,255,0.6);background:transparent;box-sizing:border-box;';
          } else {
            displaySize = size;
            bgStyle = 'background:rgba(255,255,255,' + (0.9 + Math.random() * 0.08) + ');';
          }

          const half = displaySize / 2;
          const el = document.createElement('div');
          el.style.cssText =
            'position:fixed;left:' + (rect.left + px - half) + 'px;top:' + (rect.top + py - half) + 'px;' +
            'width:' + displaySize + 'px;height:' + displaySize + 'px;border-radius:50%;' +
            bgStyle +
            'pointer-events:none;z-index:100001;opacity:0;';
          document.body.appendChild(el);

          particles.push({
            el, vx, vy, travelDist, duration,
            startX: rect.left + px,
            startY: rect.top + py
          });
        }
      }

      if (particles.length === 0) return;

      const startTime = performance.now();

      function frame(time) {
        const elapsed = time - startTime;
        let remaining = 0;

        for (const p of particles) {
          if (!p.el.parentNode) continue;
          const t = Math.min(elapsed / p.duration, 1);
          if (t >= 1) { p.el.remove(); continue; }
          remaining++;

          const ease = 1 - Math.pow(1 - t, 4);
          const x = p.startX + p.vx * p.travelDist * ease;
          const y = p.startY + p.vy * p.travelDist * ease;
          const scale = 1 - ease * 0.7;

          let opacity;
          if (t < 0.08) {
            opacity = t / 0.08;
          } else if (t > 0.55) {
            opacity = 1 - (t - 0.55) / 0.45;
          } else {
            opacity = 1;
          }

          p.el.style.transform = 'translate(' + (x - p.startX) + 'px,' + (y - p.startY) + 'px) scale(' + scale + ')';
          p.el.style.opacity = opacity;
        }

        if (remaining > 0) requestAnimationFrame(frame);
      }

      requestAnimationFrame(frame);
    }

    function animateLogoLetters() {
      const logoText = document.querySelector('.onboarding-logo-text');
      if (!logoText) return;

      const text = 'Orbit';
      logoText.innerHTML = '';
      logoText.style.visibility = 'visible';

      let flickData = [
        { name: 'flickQuick', dur: 0.45 },
        { name: 'flickStutter', dur: 0.65 },
        { name: 'flickGlitch', dur: 0.9 },
        { name: 'flickUnstable', dur: 0.75 },
        { name: 'flickLong', dur: 1.1 }
      ];
      for (let i = flickData.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [flickData[i], flickData[j]] = [flickData[j], flickData[i]];
      }

      const delays = [0, 0.2, 0.4, 0.6, 0.8];
      for (let i = delays.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [delays[i], delays[j]] = [delays[j], delays[i]];
      }

      text.split('').forEach((letter, index) => {
        const span = document.createElement('span');
        span.className = 'letter';
        span.textContent = letter;
        const jitter = (Math.random() - 0.5) * 0.1;
        span.style.animationName = flickData[index].name;
        span.style.animationDuration = `${flickData[index].dur}s`;
        span.style.animationTimingFunction = 'linear';
        span.style.animationFillMode = 'forwards';
        span.style.animationDelay = `${(delays[index] + jitter).toFixed(3)}s`;
        logoText.appendChild(span);
      });
    }

    function populateThemeCards() {
      const themeSelection = document.getElementById('themeSelection');
      if (!themeSelection) return;

      const themes = Object.keys(accentThemes);
      themeSelection.innerHTML = '';

      const themeIcons = {
        snow: '<svg viewBox="0 0 24 24"><path d="M12 2L9 9l-7 3 7 3 3 7 3-7 7-3-7-3-3-7z"/></svg>',
        neon: '<svg viewBox="0 0 24 24"><path d="M13 3L13 9L19 9L19 13L13 13L13 19L9 19L9 13L3 13L3 9L9 9L9 3L13 3z"/></svg>',
        cyber: '<svg viewBox="0 0 24 24"><path d="M4 6L4 18L8 18L8 14L16 14L16 18L20 18L20 6L16 6L16 10L8 10L8 6L4 6z"/></svg>',
        sunset: '<svg viewBox="0 0 24 24"><path d="M12 3C7.58 3 4 6.58 4 11C4 15.42 7.58 19 12 19C16.42 19 20 15.42 20 11C20 6.58 16.42 3 12 3ZM12 17C8.69 17 6 14.31 6 11C6 7.69 8.69 5 12 5C15.31 5 18 7.69 18 11C18 14.31 15.31 17 12 17Z"/><path d="M12 7L12 15M9 10L12 13L15 10"/></svg>',
        ocean: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z"/><path d="M8 12C8 10.9 8.9 10 10 10C11.1 10 12 10.9 12 12C12 13.1 11.1 14 10 14C8.9 14 8 13.1 8 12ZM14 12C14 10.9 14.9 10 16 10C17.1 10 18 10.9 18 12C18 13.1 17.1 14 16 14C14.9 14 14 13.1 14 12Z"/></svg>',
        forest: '<svg viewBox="0 0 24 24"><path d="M12 2L4 22H20L12 2ZM12 6L17 18H7L12 6Z"/><path d="M12 10L14 14H10L12 10Z"/></svg>',
        galaxy: '<svg viewBox="0 0 24 24"><path d="M12 2L9 7L4 7L4 9L8 9L8 13L4 13L4 15L8 15L8 19L4 19L4 21L9 21L12 16L15 21L20 21L20 19L16 19L16 15L20 15L20 13L16 13L16 9L20 9L20 7L15 7L12 2Z"/></svg>',
        aurora: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z"/><path d="M12 6L16 12L12 18L8 12L12 6Z"/></svg>'
      };

      const themeIconUrls = {
        snow: 'https://i.ibb.co/jPTZkZpS/image.png',
        sunset: 'https://i.ibb.co/zVMnb70D/image-2026-06-11-231050971.png',
        grape: 'https://i.ibb.co/M58hgr0F/image.png',
        dracula: 'https://i.ibb.co/d0r4nWsH/image.png',
        ocean: 'https://i.ibb.co/Z6nz0QKB/image-2026-06-11-231237791.png',
        forest: 'https://i.ibb.co/dwb0Nn2T/image.png',
        lavender: 'https://i.ibb.co/dwRrjsWK/image-2026-06-11-231356311.png',
        amber: 'https://i.ibb.co/wZVbmXKf/image.png',
        rose: 'https://i.ibb.co/jZQbLB7v/image.png'
      };

      themes.forEach(themeName => {
        const theme = accentThemes[themeName];
        const card = document.createElement('div');
        card.className = 'onboarding-theme-card';
        card.dataset.theme = themeName;

        const iconUrl = themeIconUrls[themeName];

        card.innerHTML = `
          <div class="onboarding-theme-graphic">
            <img src="${iconUrl}" alt="${themeName.charAt(0).toUpperCase() + themeName.slice(1)}" class="onboarding-theme-icon">
          </div>
          <div class="onboarding-theme-name">${themeName.charAt(0).toUpperCase() + themeName.slice(1)}</div>
        `;

        if (themeName === onboardingTheme) {
          card.classList.add('selected');
        }

        card.addEventListener('click', () => selectTheme(themeName, card));
        themeSelection.appendChild(card);
      });
    }

    function selectTheme(themeName, card) {
      onboardingTheme = themeName;
      
      document.querySelectorAll('.onboarding-theme-card').forEach(c => {
        c.classList.remove('selected');
      });
      
      card.classList.add('selected');
      
      // Preview theme
      const theme = accentThemes[themeName];
      if (theme) {
        document.documentElement.style.setProperty('--accent-a', theme.a);
        document.documentElement.style.setProperty('--accent-b', theme.b);
      }
    }

    function nextOnboardingStep() {
      if (onboardingStep < 5) {
        const currentStepEl = document.getElementById(`onboardingStep${onboardingStep}`);
        if (currentStepEl) {
          currentStepEl.classList.add('exit');
          setTimeout(() => {
            showOnboardingStep(onboardingStep + 1);
          }, 400);
        }
      } else {
        completeOnboarding();
      }
    }

    function completeOnboarding() {
      // Save onboarding data
      localStorage.setItem('onboardingCompleted', 'true');
      localStorage.setItem('username', onboardingUsername);
      
      // Apply settings
      settings.accent = onboardingTheme;
      
      // Apply audio settings based on user choice
      if (onboardingAudioEnabled) {
        settings.music = true;
        settings.sfx = true;
      } else {
        settings.music = false;
        settings.sfx = false;
      }
      
      // Save settings
      saveStoredSettings();
      
      // Apply theme
      applySettings();

      // Start background music immediately if audio was enabled
      if (onboardingAudioEnabled) {
        music.muted = false;
        music.play().catch(() => {});
        const primer = hoverAudio.cloneNode();
        primer.volume = 0;
        primer.play().catch(() => {});
      }

      // Smooth transition to home
      const onboardingFlow = document.getElementById('onboardingFlow');
      if (onboardingFlow) {
        onboardingFlow.style.transition = 'opacity 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
        onboardingFlow.style.opacity = '0';
        setTimeout(() => {
          onboardingFlow.style.display = 'none';
          goHome();
        }, 600);
      }
    }

    function initHeroClock() {
      const searchInput = document.getElementById('heroSearchInput');
      if (!searchInput) return;

      initHeroSearchEngineSelector();

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const query = searchInput.value.trim();
          if (query) {
            window.__pendingHomeSearch = query;
            loadSection('browser');
          }
        }
      });
    }

    function getHeroSearchEngines() {
      return window.OrbitSearchEngines || {};
    }

    function getSavedSearchEngineKey() {
      const engines = getHeroSearchEngines();
      const saved = localStorage.getItem('orbit_search_engine') || (window.VoltraBrowser && window.VoltraBrowser.getSetting && window.VoltraBrowser.getSetting('searchEngine')) || 'duckduckgo';
      return engines[saved] ? saved : 'duckduckgo';
    }

    function updateHeroEngineIcon() {
      const engines = getHeroSearchEngines();
      const key = getSavedSearchEngineKey();
      const icon = document.getElementById('heroEngineIcon');
      const engine = engines[key];
      if (icon && engine) {
        icon.src = engine.icon;
        icon.alt = engine.name;
      }
      const menu = document.getElementById('heroEngineMenu');
      if (menu) {
        menu.querySelectorAll('.hero-engine-option').forEach(btn => {
          btn.hidden = btn.dataset.engine === key;
        });
        menu.querySelectorAll('.hero-engine-option').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.engine === key);
        });
      }
    }

    function closeHeroEngineMenu() {
      const menu = document.getElementById('heroEngineMenu');
      const button = document.getElementById('heroEngineButton');
      if (menu) menu.classList.remove('open');
      if (button) button.setAttribute('aria-expanded', 'false');
    }

    function toggleHeroEngineMenu() {
      const menu = document.getElementById('heroEngineMenu');
      const button = document.getElementById('heroEngineButton');
      if (!menu || !button) return;
      const open = !menu.classList.contains('open');
      menu.classList.toggle('open', open);
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function selectHeroSearchEngine(key) {
      const engines = getHeroSearchEngines();
      if (!engines[key]) key = 'duckduckgo';
      if (window.VoltraBrowser && typeof window.VoltraBrowser.selectSearchEngine === 'function') {
        window.VoltraBrowser.selectSearchEngine(key);
      } else {
        localStorage.setItem('orbit_search_engine', key);
      }
      updateHeroEngineIcon();
      closeHeroEngineMenu();
    }

    function initHeroSearchEngineSelector() {
      const button = document.getElementById('heroEngineButton');
      const menu = document.getElementById('heroEngineMenu');
      if (!button || !menu || button.dataset.bound === 'true') return;
      button.dataset.bound = 'true';
      const engines = getHeroSearchEngines();
      menu.innerHTML = Object.entries(engines).map(([key, engine]) => `
        <button class="hero-engine-option" type="button" data-engine="${escapeHTML(key)}" aria-label="${escapeHTML(engine.name)}">
          <img src="${escapeHTML(engine.icon)}" alt="">
        </button>
      `).join('');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleHeroEngineMenu();
      });
      menu.addEventListener('click', (event) => {
        const option = event.target.closest('.hero-engine-option');
        if (!option) return;
        event.preventDefault();
        event.stopPropagation();
        selectHeroSearchEngine(option.dataset.engine);
      });
      document.addEventListener('click', (event) => {
        if (!event.target.closest('#heroSearchBar')) closeHeroEngineMenu();
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeHeroEngineMenu();
      });
      updateHeroEngineIcon();
    }

    // Onboarding event listeners
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[BOOT] DOMContentLoaded fired at', Date.now());
      window.__UV_BOOT_STATUS__._update('DCLfired', true);

      // Get Started button
      const getStartedBtn = document.getElementById('getStartedBtn');
      if (getStartedBtn) {
        getStartedBtn.addEventListener('click', nextOnboardingStep);
      }

      // Username input
      const usernameInput = document.getElementById('usernameInput');
      const usernameContinueBtn = document.getElementById('usernameContinueBtn');
      
      if (usernameInput && usernameContinueBtn) {
        usernameInput.addEventListener('input', (e) => {
          onboardingUsername = e.target.value.trim();
          usernameContinueBtn.disabled = onboardingUsername.length === 0;
        });

        usernameInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter' && onboardingUsername.length > 0) {
            nextOnboardingStep();
          }
        });

        usernameContinueBtn.addEventListener('click', nextOnboardingStep);
      }

      // Theme continue button
      const themeContinueBtn = document.getElementById('themeContinueBtn');
      if (themeContinueBtn) {
        themeContinueBtn.addEventListener('click', nextOnboardingStep);
      }

      // Audio buttons
      const audioSkipBtn = document.getElementById('audioSkipBtn');
      const audioEnableBtn = document.getElementById('audioEnableBtn');
      
      if (audioSkipBtn) {
        audioSkipBtn.addEventListener('click', () => {
          onboardingAudioEnabled = false;
          nextOnboardingStep();
        });
      }

      if (audioEnableBtn) {
        audioEnableBtn.addEventListener('click', () => {
          onboardingAudioEnabled = true;
          nextOnboardingStep();
        });
      }

      // Start the live clock
      initHeroClock();

      // Initialize intro/onboarding logic
      initializeIntro();

      // ---- Ultraviolet boot ----
      console.log('[BOOT] Registering getPort listener at', Date.now());
      window.__UV_BOOT_STATUS__._update('getPortListenerRegistered', true);
      // bare-mux port provider: responds to SW's getPort request with a
      // SharedWorker transport port.  The SW owns the port state — do NOT
      // infer local portReady/bareMuxReady from this handler firing.
      // Port state is synced from the SW via SYNC_PORT_STATE.
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data.type === 'getPort' && event.data.port) {
          window.__UV_BOOT_STATUS__._update('portRequestReceived', true);
          console.log('[BOOT] getPort received from SW, creating SharedWorker at', Date.now());
          console.log('[BOOT] getPort event source:', event.source ? event.source.constructor.name : 'no source', 'event.data.port type:', typeof event.data.port, 'isMessagePort:', event.data.port instanceof MessagePort);
          (function tryCreateWorker(attempt) {
            var maxAttempts = 3;
            var worker;
            try {
              worker = new SharedWorker('/uv/bare-mux-worker.js', 'bare-mux-worker');
              console.log('[BOOT] SharedWorker CONSTRUCTED OK at', Date.now(), 'attempt:', attempt, 'worker.port type:', typeof worker.port, 'isMessagePort:', worker.port instanceof MessagePort);
            } catch (e) {
              console.error('[BOOT] SharedWorker CONSTRUCTION FAILED at', Date.now(), 'attempt:', attempt, 'error:', e.message);
              if (attempt < maxAttempts) {
                console.log('[BOOT] retrying SharedWorker creation in 500ms (attempt ' + (attempt + 1) + ')');
                setTimeout(function() { tryCreateWorker(attempt + 1); }, 500);
              } else {
                console.error('[BOOT] SharedWorker creation failed after ' + maxAttempts + ' attempts');
                window.__UV_BOOT_STATUS__._update('failedStage', 'worker-creation');
              }
              return;
            }
            window.__UV_BOOT_STATUS__._update('workerConstructed', true);
            console.log('[BOOT] SharedWorker constructed, transferring port at', Date.now());
            try {
              event.data.port.postMessage(worker.port, [worker.port]);
              console.log('[BOOT] SharedWorker port TRANSFERRED OK at', Date.now());
            } catch (e) {
              console.error('[BOOT] SharedWorker port TRANSFER FAILED at', Date.now(), 'error:', e.message);
              if (attempt < maxAttempts) {
                console.log('[BOOT] retrying SharedWorker transfer in 500ms (attempt ' + (attempt + 1) + ')');
                setTimeout(function() { tryCreateWorker(attempt + 1); }, 500);
              }
              return;
            }
            window.__UV_BOOT_STATUS__._update('portTransferred', true);
            console.log('[BOOT] SharedWorker port transferred to SW at', Date.now());
          })(1);
          // Port state determined by SW authority — will be synced below
        }
        // SW broadcasts port state changes via PORT_STATE_SYNC after trackPort resolves
        if (event.data.type === 'PORT_STATE_SYNC') {
          const oldPortReady = window.__UV_BOOT_STATUS__.portReady;
          const oldBareMux = window.__UV_BOOT_STATUS__.bareMuxReady;
          const oldStatus = window.__UV_BOOT_STATUS__._log.filter(e => e.key === 'swPortStatus').slice(-1)[0];
          const oldReinit = window.__UV_BOOT_STATUS__._log.filter(e => e.key === 'swReinitCount').slice(-1)[0];
          console.log('[PORT_SYNC] state transition at', Date.now());
          console.log('[PORT_SYNC] portReady:', oldPortReady, '→', event.data.portReady);
          console.log('[PORT_SYNC] status:', oldStatus ? oldStatus.val : 'none', '→', event.data.status);
          console.log('[PORT_SYNC] reinitCount:', oldReinit ? oldReinit.val : 'none', '→', event.data.reinitCount);
          console.log('[PORT_SYNC] source: SW broadcast');
          window.__UV_BOOT_STATUS__._update('swPortStateSync', true);
          if (event.data.portReady !== undefined) {
            window.__UV_BOOT_STATUS__.portReady = event.data.portReady;
            window.__UV_BOOT_STATUS__._update('portReady', event.data.portReady);
          }
          if (event.data.portReady === true) {
            console.log('[PORT_READY] received at ' + Date.now());
            const ui = window.VoltraBrowser && window.VoltraBrowser._browserUI;
            if (ui) {
              if (typeof ui._processPendingRestoreTabs === 'function') {
                console.log('[PORT_READY] flushing pending restores');
                ui._processPendingRestoreTabs();
              }
              if (typeof ui._flushPendingNavigations === 'function') {
                console.log('[PORT_READY] flushing pending navigations');
                ui._flushPendingNavigations();
              }
            }
          }
          if (event.data.bareMuxReady !== undefined) {
            window.__UV_BOOT_STATUS__.bareMuxReady = event.data.bareMuxReady;
            window.__UV_BOOT_STATUS__._update('bareMuxReady', event.data.bareMuxReady);
          }
          if (event.data.status) {
            window.__UV_BOOT_STATUS__._update('swPortStatus', event.data.status);
          }
          // Do not auto-refresh BareMux ports from the page. A delayed or failed
          // health ping under load must not replace the MessagePort while active
          // proxy requests are in flight.
          if (event.data.portReady === false && event.data.status === 'failed') {
            console.warn('[RECOVERY] Port reported failed; automatic refresh is disabled to avoid disrupting active requests.', Date.now());
          }
        }
      });
      console.log('[BOOT] getPort listener registered, now registering SW at', Date.now());

      // ---- Ordered startup validation ----
      if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
          .then((reg) => {
            window.__UV_BOOT_STATUS__._update('swReady', true);
            console.log('[BOOT] Service worker registered at', Date.now(), 'scope:', reg.scope);
            reg.addEventListener('updatefound', () => {
              const installing = reg.installing;
              if (installing) {
                console.log('[BOOT] SW update found, state:', installing.state);
                installing.addEventListener('statechange', () => {
                  console.log('[BOOT] SW state changed to:', installing.state, 'at', Date.now());
                  if (installing.state === 'activated') {
                    window.__UV_BOOT_STATUS__._update('swActivated', true);
                    console.log('[BOOT] SW activated at', Date.now());
                    // Sync port state from SW authority after activation
                    syncPortStateFromSW();
                  }
                });
              }
            });
            // Also sync if already active (e.g., after page reload)
            if (reg.active || reg.installing === null) {
              syncPortStateFromSW();
            }
          })
          .catch((err) => {
            window.__UV_BOOT_STATUS__._update('failedStage', 'sw');
            console.error('[BOOT] Service worker registration FAILED at', Date.now(), err);
          });
      } else {
        window.__UV_BOOT_STATUS__._update('failedStage', 'sw');
        console.warn('[BOOT] Service workers not supported');
      }

      // Port health is not polled during normal browsing. BareMux/UV requests are
      // allowed to settle naturally so slow subresources are not disrupted.
    });

    window.startOnboarding = startOnboarding;
    window.checkOnboarding = checkOnboarding;
    window.selectBgMusic = selectBgMusic;
    window.toggleBgMusicDropdown = toggleBgMusicDropdown;
    window.onBgMusicCustomUrl = onBgMusicCustomUrl;
