const music = new Audio("https://files.catbox.moe/vgjm1c.mp3");
    music.loop = true;
    music.volume = 0.1;
    window.music = music;

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
        ctx.fillStyle = `rgba(255,255,255,0.7)`;
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
    const fireboyWatergirlIcon = "https://outred.org/g/assets/fireboywatergirlforesttemple/logo.jpeg";
    const fireboyWatergirlUrl = "https://script.google.com/macros/s/AKfycbw8EVdUCzgTInevqT2h0DOxeN07fjoLrB5DowKa1TlhpqFnJ1IkViYJ7uV58-8yITGztg/exec";
    const flappyBirdIcon = "https://outred.org/g/assets/flappy-bird/assets/thumb.png";
    const flappyBirdUrl = "https://scratch.mit.edu/projects/embed/17964117/";
    const fruitNinjaIcon = "https://outred.org/g/assets/fruitninja/FruitNinjaTeaser.jpg";
    const fruitNinjaUrl = "https://classroom2111.github.io/g50/class-22/";

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
          image: "https://outred.org/g/assets/papasburgeria/splash.jpg",
          url: "https://script.google.com/macros/s/AKfycbyyfjHc-YiNqGOngfUlkjS5Fvx2x0UYfkerogM_Y3-Z1BQTZW2K0AcegLUtVdRjo5nM/exec"
        },
        {
          id: "papas-pizzeria",
          title: "Papa's Pizzeria",
          desc: "Build the perfect pizza from dough to delivery. Manage toppings, oven timing, and customer satisfaction in this culinary challenge.",
          badge: "SIMULATION",
          emoji: "🍕",
          image: "https://outred.org/g/assets/papaspizzaria/papaspizzaria.jpg",
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
          image: "https://outred.org/g/assets/ducklife3/duck.png",
          url: "https://script.google.com/macros/s/AKfycbxKC46TPtFqkQ8CyDyHSxOxthdFPI4de6mTUDZsmdXhUjxictSPiOGP0NEREVNrOH8P/exec"
        },
        {
          id: "duck-life-4",
          title: "Duck Life 4",
          desc: "Explore a vast world with your duck team. Train multiple ducks, discover new areas, and compete in the ultimate duck championships.",
          badge: "ADVENTURE",
          emoji: "🏆",
          image: "https://outred.org/g/assets/ducklife4/splash.jpg",
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
          url: "https://blog.free-dyndns.org/scram/res/hvtrs8%2F-jaw%3A7%2Cgktju%60.ko-c0-qm%601-"
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
          image: "https://blob-opera.com/wp-content/uploads/2025/10/Blob-Opera.webp",
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
          image: "https://outred.org/g/assets/temple-run-2/img/og-icon.png",
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
          image: "https://run3gamefree.com/run-3.webp",
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
          image: "https://outred.org/g/assets/superhot/hot.jpg",
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
          image: "https://outred.org/g/assets/plants%20vs%20zombies%201/image_proxy.png",
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
          url: "https://data.gamechy.com/9f23979e-d4d9-4be9-9dd7-7a399f5331c7/index.html?noads=true"
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
        }
      ],
      tools: []
    };

    const gameIndex = Object.fromEntries(sectionData.games.map(game => [game.id, game]));

    const suggestionData = [
      { title: "Clicker Picks", desc: "More fast idle games and clicker loops will appear here as the library expands.", badge: "SOON", emoji: "⚡" },
      { title: "Idle Progression", desc: "A future shelf for upgrade-heavy games with satisfying long-term progress.", badge: "QUEUE", emoji: "📈" },
      { title: "Cozy Classics", desc: "Lightweight browser favorites that fit the same quick-play rhythm.", badge: "NEXT", emoji: "✨" }
    ];

    const infoSearchData = [
      { title: "About Orbit", desc: "A modern browser hub for games, tools, proxies, and web apps.", badge: "INFO", emoji: "💫" },
      { title: "Early Access", desc: "Orbit is still expanding, with more sections and launchable content planned.", badge: "SOON", emoji: "🚀" },
      { title: "Visual System", desc: "Glass panels, ambient particles, custom themes, and neon illumination.", badge: "STYLE", emoji: "✨" },
      { title: "Settings", desc: "Tune audio, visuals, motion, contrast, particles, and layout behavior.", badge: "CUSTOM", emoji: "⚙️" }
    ];

    const searchPages = {
      games: { label: "Games", items: sectionData.games },
      tools: { label: "Tools", items: sectionData.tools },
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
      accent: 'pure',
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
      bypassKeybind: ''
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

    const accentThemes = {
      pure: { a: '255,255,255', b: '255,255,255', c: '255,255,255' },
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

    function scrollBehavior() {
      return settings.smoothScroll ? 'smooth' : 'auto';
    }

    const heroSection = document.getElementById('heroSection');
    const mainContent = document.getElementById('mainContent');
    const homeSearchStack = document.getElementById('homeSearchStack');
    const homeSearchResults = document.getElementById('homeSearchResults');
    const homeSearchInput = document.getElementById('homeSearchInput');

    const fullPageSections = ['settings', 'games', 'search', 'tools', 'info', 'browser'];

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
        <div class="game-card" ${cardOpenAttrs(section, item)}>
          <div class="game-thumb">${buildThumb(item)}</div>
          <span class="game-card-label">${escapeHTML(item.title)}</span>
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
        tools: "Tools"
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
                  placeholder="Search Orbit for games"
                  aria-label="Search Orbit for games">
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
        <div class="game-page">
          <div class="game-page-wrap">
            <section class="game-detail-hero">
              <div class="game-detail-copy">
                <div class="game-detail-icon">
                  <img src="${escapeHTML(game.image)}" alt="${escapeHTML(game.title)} icon">
                </div>
                <div>
                  <h2>${escapeHTML(game.title)}</h2>
                  <p>${escapeHTML(game.desc)}</p>
                </div>
              </div>
              <div class="game-actions">
                ${backButtonHTML}
                ${fullscreenButtonHTML}
                ${newTabButtonHTML(game.id, 'game')}
              </div>
            </section>

            <section class="game-frame-card">
              <div class="game-frame-top">
                <span>Embedded Game</span>
                <span>${escapeHTML(game.title)}</span>
              </div>
              <div class="game-frame-wrap" id="gameFrameWrap">
                <iframe
                  id="gameFrame"
                  src="${escapeHTML(game.url)}"
                  title="${escapeHTML(game.title)}"
                  allow="fullscreen"
                  allowfullscreen
                  loading="lazy"></iframe>
              </div>
            </section>

            ${settings.showPlayerSuggestions ? `
            <section class="game-suggestions">
              <h3>Game Suggestions</h3>
              <div class="suggestion-grid">
                ${suggestionData.map(item => `
                  <div class="suggestion-card">
                    <span>${item.emoji}</span>
                    <h4>${escapeHTML(item.title)}</h4>
                    <p>${escapeHTML(item.desc)}</p>
                  </div>
                `).join('')}
              </div>
            </section>
            ` : ''}
          </div>
        </div>
      `;
    }

    function buildInfoHTML() {
      return `
        <div class="info-page">
          <div class="info-wrap">
            <section class="info-hero">
              <div class="info-kicker">Orbit Hub</div>
              <h2>Fast access, clean visuals, and everything in one place.</h2>
              <p>
                Orbit is designed as a modern browser launchpad for games, proxy tools, utilities, and lightweight web apps.
                The interface keeps things atmospheric without getting in the way, so switching from play to tools feels quick and natural.
              </p>
              <div class="info-stats">
                <div class="info-stat">
                  <strong>4</strong>
                  <span>Main hub categories</span>
                </div>
                <div class="info-stat">
                  <strong>46+</strong>
                  <span>Playable games</span>
                </div>
                <div class="info-stat">
                  <strong>v2.1</strong>
                  <span>Early access release</span>
                </div>
              </div>
            </section>

            <div class="info-layout">
              <section class="info-panel">
                <h3>What Orbit includes</h3>
                <p>
                  The site is organized around the things people actually open often: games, proxies, tools, and general updates.
                  Each area can grow without changing the overall feel of the hub.
                </p>
                <div class="info-feature-grid">
                  <div class="info-feature">
                    <span>🍪</span>
                    <h4>Cookie Clicker</h4>
                    <p>The current featured game launches inside a themed Orbit player page.</p>
                  </div>
                  <div class="info-feature">
                    <span>🌐</span>
                    <h4>Gust Proxy</h4>
                    <p>Download and run GUST on any device, then open it here with fullscreen and private-tab controls.</p>
                  </div>
                  <div class="info-feature">
                    <span>🧰</span>
                    <h4>Useful Tools</h4>
                    <p>Lightweight utilities for notes, links, tabs, files, and small browser workflows.</p>
                  </div>
                  <div class="info-feature">
                    <span>✨</span>
                    <h4>Custom Feel</h4>
                    <p>Theme colors, glow intensity, particles, motion, layout density, and audio controls.</p>
                  </div>
                </div>
              </section>

              <aside class="info-panel">
                <h3>Project Notes</h3>
                <div class="info-list">
                  <div class="info-list-item">
                    <div class="info-dot"></div>
                    <div>
                      <strong>Early Access</strong>
                      <p>Orbit is still expanding, with more sections and launchable content planned.</p>
                    </div>
                  </div>
                  <div class="info-list-item">
                    <div class="info-dot"></div>
                    <div>
                      <strong>Visual System</strong>
                      <p>The current style uses glass panels, ambient particles, and adjustable neon illumination.</p>
                    </div>
                  </div>
                  <div class="info-list-item">
                    <div class="info-dot"></div>
                    <div>
                      <strong>Game Player</strong>
                      <p>Games open in a dedicated themed page with fullscreen and new-tab controls.</p>
                    </div>
                  </div>
                  <div class="info-list-item">
                    <div class="info-dot"></div>
                    <div>
                      <strong>Settings</strong>
                      <p>Use the cog to tune audio, visuals, motion, contrast, and page layout behavior.</p>
                    </div>
                  </div>
                </div>
              </aside>
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

      const audioPanel = panel('audio', 'Audio', 'Control background music and interface sound effects.', `
        ${toggleRow('music', 'Background Music', 'Play atmospheric music while you browse.', settings.music)}
        ${rangeRow('musicVolume', 'Music Volume', 'Set the background music level.', 0, 50, 1)}
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
          { value: 'pure', label: 'Snow' },
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

      const settingsNavIconHTML = (panelId) => {
        // Sleek outline-style icons (matched to sidebar meaning)
        switch (panelId) {
          case 'audio':
            // Speaker / sound
            return `
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 5 6 9H2v6h4l5 4z"></path>
                <path d="M15.5 8.5a4 4 0 0 1 0 7"></path>
                <path d="M18.8 5.2a9 9 0 0 1 0 13.6"></path>
              </svg>`;

          case 'appearance':
            // Palette / theme
            return `
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 21a9 9 0 1 1 9-9c0 2.5-1.3 4-3.2 4H16a2 2 0 0 0-2 2c0 1.8-1.2 3-2 3z"></path>
                <path d="M7.5 10.2h.01"></path>
                <path d="M10.2 7.5h.01"></path>
                <path d="M14.3 7.5h.01"></path>
                <path d="M16.9 10.2h.01"></path>
              </svg>`;

          case 'layout':
            // Cloaking / hidden (eye-off)
            return `
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path>
                <path d="M9.5 9.5a3.5 3.5 0 0 0 5 5"></path>
                <path d="M1 1l22 22"></path>
              </svg>`;

          case 'browser':
            // Browser / globe (proxy icon)
            return `
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M3 12h18"></path>
                <path d="M12 3a15 15 0 0 1 0 18"></path>
                <path d="M12 3a15 15 0 0 0 0 18"></path>
              </svg>`;

          case 'launching':
            // Launching / rocket
            return `
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
                <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
                <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path>
                <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
              </svg>`;

          case 'about':
            // Info / question
            return `
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M12 11v5"></path>
                <path d="M12 8h.01"></path>
              </svg>`;

          case 'performance':
            // Account / user profile
            return `
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>`;

          default:
            return `
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z"></path>
              </svg>`;
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

              </nav>
              <div class="settings-panels">
                ${audioPanel}
                ${appearancePanel}
                ${layoutPanel}
                ${launchingPanel}
                ${browserPanel}
                ${performancePanel}
                ${aboutPanel}
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
      if (section === 'games' || section === 'tools') {
        lastBrowseQuery = query;
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

    function openGame(id) {
      const game = gameIndex[id];
      if (!game) return;

      captureBrowseState('games');
      currentSection = 'game';
      heroSection.style.display = 'none';
      mainContent.innerHTML = buildGamePage(id);
      setActiveNav('games');
      attachHoverSFX();
      updateTabCloakState();
      maybeAutoLaunchExternal(game.url, game.title);
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
      requestAnimationFrame(syncLayout);
    }

    function backFromPlayer() {
      render(returnSection, lastBrowseQuery);
      heroSection.style.display = 'none';
      setActiveNav(returnSection);
      attachHoverSFX();
      updateTabCloakState();
      window.scrollTo({ top: 0, behavior: 'auto' });
      requestAnimationFrame(syncLayout);
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

    function openGameTab(id) {
      const game = gameIndex[id];
      if (!game) return;
      window.open(game.url, '_blank', 'noopener,noreferrer');
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
      heroSection.style.display = 'none';
      mainContent.innerHTML = '<div id="browserMount"></div>';
      setActiveNav('browser');
      attachHoverSFX();
      updateTabCloakState();
      window.scrollTo({ top: 0, behavior: 'auto' });
      requestAnimationFrame(() => {
        const mount = document.getElementById('browserMount');
        if (mount && window.VoltraBrowser) {
          VoltraBrowser.render(mount);
        }
      });
    }

    function goHome() {
      heroSection.style.display = '';
      mainContent.innerHTML = '';
      currentSection = null;
      setActiveNav(null);
      document.body.classList.add('on-homepage');
      clearHomeSearch();
      updateTabCloakState();
      window.scrollTo({ top: 0, behavior: scrollBehavior() });
    }

    function applySettings() {
      const root = document.documentElement;
      let theme = accentThemes[settings.accent];
      if (!theme) {
        theme = accentThemes.pure;
        settings.accent = 'pure';
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

    function resetSettings() {
      Object.assign(settings, defaultSettings);
      settingsPanel = 'audio';
      try {
        localStorage.removeItem(SETTINGS_STORAGE_KEY);
      } catch (err) {
        console.warn('Could not clear saved settings.', err);
      }
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
      document.querySelectorAll('.game-card, .info-panel, .info-feature, .settings-reset, .settings-nav-item, .home-search-item, .suggestion-card, .icon-btn, .proxy-open-btn').forEach(el => {
        if (!el.dataset.sfx) {
          el.dataset.sfx = "1";
          el.addEventListener('mouseenter', () => playHover(0.92));
        }
      });
    }

    document.querySelectorAll('.nav-icon').forEach(el => {
      el.addEventListener('mouseenter', () => playHover(1));
    });

    document.querySelectorAll('.hero-search').forEach(el => {
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
        
        passwordOverlay.style.display = 'flex';
        passwordInput.value = '';
        passwordError.classList.remove('show');
        passwordInput.focus();
        
        document.body.style.overflow = 'hidden';
      }
    }

    function submitPassword() {
      const passwordInput = document.getElementById('passwordInput');
      const passwordError = document.getElementById('passwordError');
      const passwordOverlay = document.getElementById('passwordOverlay');
      
      if (passwordInput.value === settings.websitePassword) {
        passwordOverlay.style.display = 'none';
        document.body.style.overflow = '';
      } else {
        passwordError.classList.add('show');
        passwordInput.value = '';
        passwordInput.focus();
      }
    }

    document.addEventListener('keydown', (e) => {
      if (settings.requirePassword && settings.websitePassword && settings.bypassKeybind) {
        const passwordOverlay = document.getElementById('passwordOverlay');
        if (passwordOverlay && passwordOverlay.style.display === 'flex') {
          if (e.shiftKey && e.key.toUpperCase() === settings.bypassKeybind.toUpperCase()) {
            passwordOverlay.style.display = 'none';
            document.body.style.overflow = '';
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