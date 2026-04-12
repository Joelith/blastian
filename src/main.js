import Phaser from "phaser";
import gameConfigData from "./data/levels.json";

const CONFIG_CACHE_KEY = "gameConfig";
const HIGH_SCORE_STORAGE_KEY = "blastian.highScore.v1";
const DEFAULT_HIGH_SCORE = Object.freeze({
  initials: "AAA",
  score: 0
});
const INITIALS_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DEFAULT_WEAPON_HEAT_CONFIG = Object.freeze({
  enabled: true,
  maxHeat: 100,
  heatPerShot: 9,
  coolPerSecond: 28,
  overheatLockMs: 2200,
  ui: {
    label: "HEAT",
    x: 8,
    yOffsetFromBottom: 8,
    width: 110,
    height: 10
  }
});

function getConfiguredAudioEntries(audioConfig) {
  const entries = [];
  if (audioConfig?.music) {
    entries.push({
      id: "music",
      key: audioConfig.music.key ?? "bgMusic",
      config: audioConfig.music
    });
  }

  const sfxConfig = audioConfig?.sfx ?? {};
  Object.entries(sfxConfig).forEach(([id, config]) => {
    entries.push({
      id,
      key: config?.key ?? `sfx-${id}`,
      config
    });
  });

  return entries;
}

class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload() {
    const bindings = gameConfigData.assets?.bindings ?? {};
    Object.entries(bindings).forEach(([textureKey, binding]) => {
      if (!binding?.enabled || !binding.path) {
        return;
      }
      this.load.image(textureKey, binding.path);
    });

    const audioEntries = getConfiguredAudioEntries(gameConfigData.audio);
    audioEntries.forEach((entry) => {
      if (!entry.config?.enabled || !entry.config?.path) {
        return;
      }
      this.load.audio(entry.key, entry.config.path);
    });
  }

  create() {
    if (this.cache.json.exists(CONFIG_CACHE_KEY)) {
      this.cache.json.remove(CONFIG_CACHE_KEY);
    }
    this.cache.json.add(CONFIG_CACHE_KEY, gameConfigData);
    this.scene.start("TitleScene");
  }
}

class TitleScene extends Phaser.Scene {
  constructor() {
    super("TitleScene");
  }

  create() {
    const gameConfig = this.cache.json.get(CONFIG_CACHE_KEY);
    const levelOne = gameConfig.levels[0];
    const centerX = this.scale.width * 0.5;
    const centerY = this.scale.height * 0.5;

    this.cameras.main.setBackgroundColor("#070b1f");

    this.add
      .text(centerX, centerY - 110, gameConfig.game.title, {
        fontFamily: "Courier New",
        fontSize: "40px",
        color: "#9ce3ff",
        stroke: "#0e234f",
        strokeThickness: 6
      })
      .setOrigin(0.5);

    this.add
      .text(centerX, centerY - 58, "Top-Down Space Shooter", {
        fontFamily: "Courier New",
        fontSize: "14px",
        color: "#d8f2ff"
      })
      .setOrigin(0.5);

    this.add
      .text(
        centerX,
        centerY + 2,
        `Level 1: ${levelOne.name}\n${levelOne.description}`,
        {
          align: "center",
          fontFamily: "Courier New",
          fontSize: "12px",
          color: "#ffffff",
          lineSpacing: 5
        }
      )
      .setOrigin(0.5);

    const startPrompt = this.add
      .text(centerX, centerY + 90, "PRESS ENTER TO START", {
        fontFamily: "Courier New",
        fontSize: "16px",
        color: "#fff88f"
      })
      .setOrigin(0.5);

    this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        startPrompt.setVisible(!startPrompt.visible);
      }
    });

    this.add
      .text(
        centerX,
        this.scale.height - 40,
        "Arrow keys: move  |  Space: shoot",
        {
          fontFamily: "Courier New",
          fontSize: "11px",
          color: "#8aa2ca"
        }
      )
      .setOrigin(0.5);

    this.add
      .text(
        centerX,
        this.scale.height - 22,
        "Copyright Jobalakai Enterprises 2026",
        {
          fontFamily: "Courier New",
          fontSize: "10px",
          color: "#6e83ad"
        }
      )
      .setOrigin(0.5);

    this.input.keyboard.once("keydown-ENTER", () => {
      this.scene.start("GameScene", { levelIndex: 0 });
    });
  }
}

class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  init(data) {
    this.levelIndex = data.levelIndex ?? 0;
  }

  create() {
    const gameConfig = this.cache.json.get(CONFIG_CACHE_KEY);
    this.assetBindings = gameConfig.assets?.bindings ?? {};
    this.hitboxConfig = gameConfig.hitboxes ?? {};
    this.audioConfig = gameConfig.audio ?? {};
    this.weaponHeatConfig = this.buildWeaponHeatConfig(gameConfig.weaponHeat);
    this.enemyTypes = gameConfig.enemyTypes;
    this.levelConfig = gameConfig.levels[this.levelIndex];
    this.playerConfig = {
      lives: 3,
      moveSpeed: 200,
      fireCooldownMs: 160,
      invulnerableMs: 1000,
      ...(gameConfig.player ?? {})
    };

    this.cameras.main.setBackgroundColor("#040712");
    this.createBackgroundStars();
    this.createPlaceholderTextures();
    this.setupAudio();

    this.score = 0;
    this.lives = this.playerConfig.lives;
    this.isGameOver = false;
    this.levelCleared = false;
    this.pendingSpawns = 0;
    this.playerInvulnerable = false;
    this.nextPlayerShotAt = 0;
    this.highScoreKeyHandler = null;
    this.initialsChars = ["A", "A", "A"];
    this.initialsCursor = 0;
    this.highScore = this.loadHighScore();
    this.highScoreEntryMode = "gameover";
    this.weaponHeat = 0;
    this.isWeaponOverheated = false;
    this.weaponOverheatedUntil = 0;
    this.weaponHeatFlashTween = null;
    this.weaponHeatBarBg = null;
    this.weaponHeatBarFill = null;
    this.weaponHeatBarLabel = null;
    this.weaponHeatBarInnerWidth = 0;
    this.weaponHeatBarInnerHeight = 0;

    this.cursors = this.input.keyboard.createCursorKeys();
    this.fireKey = this.input.keyboard.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );

    this.player = this.physics.add
      .sprite(this.scale.width * 0.5, this.scale.height - 62, "playerShip")
      .setCollideWorldBounds(true)
      .setDepth(2);
    this.player.setScale(this.getTextureScale("playerShip"));
    this.player.body.allowGravity = false;
    this.applyConfiguredHitbox(this.player, "player");

    this.playerBullets = this.physics.add.group();
    this.enemyBullets = this.physics.add.group();
    this.enemies = this.physics.add.group();

    this.physics.add.overlap(
      this.playerBullets,
      this.enemies,
      this.handlePlayerBulletHitEnemy,
      undefined,
      this
    );
    this.physics.add.overlap(
      this.enemyBullets,
      this.player,
      this.handlePlayerHit,
      undefined,
      this
    );
    this.physics.add.overlap(
      this.enemies,
      this.player,
      this.handlePlayerHit,
      undefined,
      this
    );

    this.scoreText = this.add.text(8, 8, "SCORE 000000", {
      fontFamily: "Courier New",
      fontSize: "12px",
      color: "#f0fcff"
    });
    this.highScoreText = this.add.text(this.scale.width * 0.5, 8, "HI AAA 000000", {
      fontFamily: "Courier New",
      fontSize: "12px",
      color: "#f0fcff"
    });
    this.highScoreText.setOrigin(0.5, 0);
    this.livesText = this.add.text(this.scale.width - 8, 8, `LIVES ${this.lives}`, {
      fontFamily: "Courier New",
      fontSize: "12px",
      color: "#f0fcff"
    });
    this.livesText.setOrigin(1, 0);

    this.messageText = this.add
      .text(this.scale.width * 0.5, this.scale.height * 0.5, "", {
        align: "center",
        fontFamily: "Courier New",
        fontSize: "18px",
        color: "#fff88f",
        lineSpacing: 8
      })
      .setOrigin(0.5)
      .setDepth(4)
      .setVisible(false);

    this.createWeaponHeatUi();
    this.updateUiText();
    this.scheduleLevelWaves();
  }

  update(time, delta) {
    if (!this.isGameOver && !this.levelCleared) {
      this.updatePlayerMovement();
      this.updateWeaponHeat(time, delta);
      this.tryPlayerShoot(time);
      this.updateEnemies(time, delta);
      this.cleanupOffscreenProjectiles();
      this.checkLevelClearState();
    }
  }

  createBackgroundStars() {
    const stars = this.add.group();
    const starCount = Math.max(
      80,
      Math.floor((this.scale.width * this.scale.height) / 2200)
    );
    for (let i = 0; i < starCount; i += 1) {
      const star = this.add.rectangle(
        Phaser.Math.Between(0, this.scale.width),
        Phaser.Math.Between(0, this.scale.height),
        1,
        1,
        0xc6d8ff,
        Phaser.Math.FloatBetween(0.2, 0.9)
      );
      stars.add(star);
    }

    this.time.addEvent({
      delay: 50,
      loop: true,
      callback: () => {
        stars.getChildren().forEach((star) => {
          star.y += 1.1;
          if (star.y > this.scale.height + 4) {
            star.y = -2;
            star.x = Phaser.Math.Between(0, this.scale.width);
          }
        });
      }
    });
  }

  createPlaceholderTextures() {
    const createTexture = (key, width, height, fillColor, borderColor) => {
      if (this.textures.exists(key)) {
        return;
      }

      const graphics = this.make.graphics({ x: 0, y: 0, add: false });
      graphics.fillStyle(fillColor, 1);
      graphics.fillRect(0, 0, width, height);
      graphics.lineStyle(1, borderColor, 1);
      graphics.strokeRect(0.5, 0.5, width - 1, height - 1);
      graphics.generateTexture(key, width, height);
      graphics.destroy();
    };

    createTexture("playerShip", 14, 14, 0x83f2ff, 0x153f5a);
    createTexture("playerLaser", 3, 10, 0x96ff7f, 0x2a6820);
    createTexture("enemyLaser", 3, 9, 0xff7f93, 0x7a1f2e);

    createTexture("enemyDrone", 12, 12, 0xffc56b, 0x7e4f0d);
    createTexture("enemyStriker", 12, 12, 0xff7fcd, 0x6d1d52);
    createTexture("enemyTurret", 16, 16, 0x99a7ff, 0x1f2c7e);
    createTexture("enemyGunship", 18, 12, 0xff968a, 0x7f2a1c);
  }

  getTextureScale(textureKey) {
    const binding = this.assetBindings?.[textureKey];
    const parsedScale = Number(binding?.scale);
    if (!Number.isFinite(parsedScale) || parsedScale <= 0) {
      return 1;
    }
    return parsedScale;
  }

  getHitboxOptions(hitboxKey) {
    const defaults = {
      player: {
        widthScale: 1,
        heightScale: 1,
        minWidth: 20,
        minHeight: 20
      },
      enemy: {
        widthScale: 1,
        heightScale: 1,
        minWidth: 18,
        minHeight: 18
      },
      playerLaser: {
        widthScale: 1.5,
        heightScale: 1.5,
        minWidth: 8,
        minHeight: 12
      },
      enemyLaser: {
        widthScale: 1.5,
        heightScale: 1.5,
        minWidth: 8,
        minHeight: 11
      }
    };

    return {
      ...(defaults[hitboxKey] ?? {}),
      ...(this.hitboxConfig?.[hitboxKey] ?? {})
    };
  }

  applyConfiguredHitbox(sprite, hitboxKey) {
    if (!sprite?.body) {
      return;
    }

    const options = this.getHitboxOptions(hitboxKey);
    const explicitWidth = Number(options.width);
    const explicitHeight = Number(options.height);
    const widthScale = Number(options.widthScale);
    const heightScale = Number(options.heightScale);
    const minWidth = Number(options.minWidth);
    const minHeight = Number(options.minHeight);

    const resolvedWidth =
      Number.isFinite(explicitWidth) && explicitWidth > 0
        ? explicitWidth
        : sprite.displayWidth * (Number.isFinite(widthScale) && widthScale > 0 ? widthScale : 1);
    const resolvedHeight =
      Number.isFinite(explicitHeight) && explicitHeight > 0
        ? explicitHeight
        : sprite.displayHeight * (Number.isFinite(heightScale) && heightScale > 0 ? heightScale : 1);

    const finalWidth = Math.max(
      Number.isFinite(minWidth) && minWidth > 0 ? minWidth : 1,
      Math.round(resolvedWidth)
    );
    const finalHeight = Math.max(
      Number.isFinite(minHeight) && minHeight > 0 ? minHeight : 1,
      Math.round(resolvedHeight)
    );

    sprite.body.setSize(finalWidth, finalHeight, true);
  }

  getNumericValue(value, fallbackValue) {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) ? parsedValue : fallbackValue;
  }

  buildWeaponHeatConfig(rawConfig) {
    const resolvedConfig = rawConfig ?? {};
    const resolvedUiConfig = {
      ...DEFAULT_WEAPON_HEAT_CONFIG.ui,
      ...(resolvedConfig.ui ?? {})
    };
    const maxHeat = Math.max(
      1,
      this.getNumericValue(
        resolvedConfig.maxHeat,
        DEFAULT_WEAPON_HEAT_CONFIG.maxHeat
      )
    );

    return {
      enabled: resolvedConfig.enabled !== false,
      maxHeat,
      heatPerShot: Math.max(
        0,
        this.getNumericValue(
          resolvedConfig.heatPerShot,
          DEFAULT_WEAPON_HEAT_CONFIG.heatPerShot
        )
      ),
      coolPerSecond: Math.max(
        0,
        this.getNumericValue(
          resolvedConfig.coolPerSecond,
          DEFAULT_WEAPON_HEAT_CONFIG.coolPerSecond
        )
      ),
      overheatLockMs: Math.max(
        0,
        this.getNumericValue(
          resolvedConfig.overheatLockMs,
          DEFAULT_WEAPON_HEAT_CONFIG.overheatLockMs
        )
      ),
      ui: {
        label: resolvedUiConfig.label ?? DEFAULT_WEAPON_HEAT_CONFIG.ui.label,
        x: this.getNumericValue(
          resolvedUiConfig.x,
          DEFAULT_WEAPON_HEAT_CONFIG.ui.x
        ),
        yOffsetFromBottom: this.getNumericValue(
          resolvedUiConfig.yOffsetFromBottom,
          DEFAULT_WEAPON_HEAT_CONFIG.ui.yOffsetFromBottom
        ),
        width: Math.max(
          40,
          this.getNumericValue(
            resolvedUiConfig.width,
            DEFAULT_WEAPON_HEAT_CONFIG.ui.width
          )
        ),
        height: Math.max(
          6,
          this.getNumericValue(
            resolvedUiConfig.height,
            DEFAULT_WEAPON_HEAT_CONFIG.ui.height
          )
        )
      }
    };
  }

  createWeaponHeatUi() {
    if (!this.weaponHeatConfig.enabled) {
      return;
    }

    const uiConfig = this.weaponHeatConfig.ui;
    const x = uiConfig.x;
    const y = this.scale.height - uiConfig.yOffsetFromBottom - uiConfig.height;
    const width = uiConfig.width;
    const height = uiConfig.height;

    this.weaponHeatBarLabel = this.add.text(x, y - 12, uiConfig.label, {
      fontFamily: "Courier New",
      fontSize: "10px",
      color: "#9eb5d7"
    });
    this.weaponHeatBarLabel.setDepth(3);

    this.weaponHeatBarBg = this.add
      .rectangle(x, y, width, height, 0x11192b)
      .setOrigin(0, 0)
      .setDepth(3);
    this.weaponHeatBarBg.setStrokeStyle(1, 0x496287, 1);

    this.weaponHeatBarInnerWidth = Math.max(1, width - 2);
    this.weaponHeatBarInnerHeight = Math.max(1, height - 2);
    this.weaponHeatBarFill = this.add
      .rectangle(
        x + 1,
        y + 1,
        this.weaponHeatBarInnerWidth,
        this.weaponHeatBarInnerHeight,
        0x57e86c
      )
      .setOrigin(0, 0)
      .setDepth(3);

    this.updateWeaponHeatUi();
  }

  updateWeaponHeat(time, delta) {
    if (!this.weaponHeatConfig.enabled) {
      return;
    }

    if (this.isWeaponOverheated) {
      this.weaponHeat = this.weaponHeatConfig.maxHeat;
      if (time >= this.weaponOverheatedUntil) {
        this.isWeaponOverheated = false;
        this.weaponHeat = 0;
        this.stopWeaponHeatFlash();
      }
      this.updateWeaponHeatUi();
      return;
    }

    if (!this.fireKey?.isDown) {
      const coolingAmount =
        this.weaponHeatConfig.coolPerSecond * (delta / 1000);
      if (coolingAmount > 0) {
        this.weaponHeat = Math.max(0, this.weaponHeat - coolingAmount);
        this.updateWeaponHeatUi();
      }
    }
  }

  applyWeaponHeatFromShot(time) {
    if (!this.weaponHeatConfig.enabled || this.isWeaponOverheated) {
      return;
    }

    this.weaponHeat = Math.min(
      this.weaponHeatConfig.maxHeat,
      this.weaponHeat + this.weaponHeatConfig.heatPerShot
    );

    if (this.weaponHeat >= this.weaponHeatConfig.maxHeat) {
      this.weaponHeat = this.weaponHeatConfig.maxHeat;
      this.isWeaponOverheated = true;
      this.weaponOverheatedUntil = time + this.weaponHeatConfig.overheatLockMs;
      this.startWeaponHeatFlash();
    }

    this.updateWeaponHeatUi();
  }

  startWeaponHeatFlash() {
    if (this.weaponHeatFlashTween || !this.weaponHeatBarFill || !this.weaponHeatBarBg) {
      return;
    }

    this.weaponHeatFlashTween = this.tweens.add({
      targets: [this.weaponHeatBarFill, this.weaponHeatBarBg],
      alpha: 0.25,
      yoyo: true,
      repeat: -1,
      duration: 120
    });
  }

  stopWeaponHeatFlash() {
    if (this.weaponHeatFlashTween) {
      this.weaponHeatFlashTween.stop();
      this.weaponHeatFlashTween = null;
    }

    if (this.weaponHeatBarFill) {
      this.weaponHeatBarFill.setAlpha(1);
    }
    if (this.weaponHeatBarBg) {
      this.weaponHeatBarBg.setAlpha(1);
    }
  }

  updateWeaponHeatUi() {
    if (!this.weaponHeatConfig.enabled || !this.weaponHeatBarFill) {
      return;
    }

    const ratio = Phaser.Math.Clamp(
      this.weaponHeat / this.weaponHeatConfig.maxHeat,
      0,
      1
    );
    const currentWidth = Math.round(this.weaponHeatBarInnerWidth * ratio);
    this.weaponHeatBarFill.setSize(currentWidth, this.weaponHeatBarInnerHeight);

    let fillColor = 0x57e86c;
    if (ratio >= 1) {
      fillColor = 0xff4d5a;
    } else if (ratio >= 0.75) {
      fillColor = 0xff984a;
    } else if (ratio >= 0.5) {
      fillColor = 0xf9d65c;
    }
    this.weaponHeatBarFill.setFillStyle(fillColor, 1);
  }

  setupAudio() {
    this.backgroundMusic = null;
    this.startBackgroundMusic();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cleanupHighScoreInput();
      this.stopWeaponHeatFlash();
      this.stopBackgroundMusic();
    });
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.cleanupHighScoreInput();
      this.stopWeaponHeatFlash();
      this.stopBackgroundMusic();
    });
  }

  startBackgroundMusic() {
    const musicConfig = this.audioConfig?.music;
    if (!musicConfig?.enabled) {
      return;
    }

    const musicKey = musicConfig.key ?? "bgMusic";
    if (!this.cache.audio.exists(musicKey)) {
      return;
    }

    if (this.sound.locked) {
      this.sound.once("unlocked", () => {
        this.startBackgroundMusic();
      });
      return;
    }

    if (this.backgroundMusic?.isPlaying) {
      return;
    }

    this.backgroundMusic = this.sound.add(musicKey, {
      loop: musicConfig.loop !== false,
      volume: this.getNumericValue(musicConfig.volume, 0.35)
    });
    this.backgroundMusic.play();
  }

  stopBackgroundMusic() {
    if (!this.backgroundMusic) {
      return;
    }

    if (this.backgroundMusic.isPlaying) {
      this.backgroundMusic.stop();
    }
    this.backgroundMusic.destroy();
    this.backgroundMusic = null;
  }

  playSfx(sfxId) {
    const sfxConfig = this.audioConfig?.sfx?.[sfxId];
    if (!sfxConfig?.enabled) {
      return;
    }

    const soundKey = sfxConfig.key ?? `sfx-${sfxId}`;
    if (this.cache.audio.exists(soundKey)) {
      this.sound.play(soundKey, {
        volume: this.getNumericValue(sfxConfig.volume, 0.2),
        rate: this.getNumericValue(sfxConfig.rate, 1),
        detune: this.getNumericValue(sfxConfig.detune, 0)
      });
      return;
    }

    this.playFallbackTone(sfxConfig.fallbackTone);
  }

  playFallbackTone(fallbackToneConfig) {
    if (!fallbackToneConfig?.enabled) {
      return;
    }

    const audioContext = this.sound.context;
    if (!audioContext) {
      return;
    }

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const now = audioContext.currentTime;

    const type = fallbackToneConfig.type ?? "square";
    const frequency = this.getNumericValue(fallbackToneConfig.frequency, 440);
    const attackSeconds =
      this.getNumericValue(fallbackToneConfig.attackMs, 5) / 1000;
    const decaySeconds =
      this.getNumericValue(fallbackToneConfig.decayMs, 90) / 1000;
    const volume = this.getNumericValue(fallbackToneConfig.volume, 0.02);

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(volume, now + attackSeconds);
    gainNode.gain.exponentialRampToValueAtTime(
      0.0001,
      now + attackSeconds + decaySeconds
    );

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + attackSeconds + decaySeconds + 0.01);
  }

  sanitizeInitials(value) {
    const letters = String(value ?? "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");
    return `${letters}AAA`.slice(0, 3);
  }

  sanitizeScore(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }
    return Math.floor(parsed);
  }

  loadHighScore() {
    if (typeof window === "undefined" || !window.localStorage) {
      return { ...DEFAULT_HIGH_SCORE };
    }

    try {
      const rawValue = window.localStorage.getItem(HIGH_SCORE_STORAGE_KEY);
      if (!rawValue) {
        return { ...DEFAULT_HIGH_SCORE };
      }

      const parsedValue = JSON.parse(rawValue);
      return {
        initials: this.sanitizeInitials(parsedValue.initials),
        score: this.sanitizeScore(parsedValue.score)
      };
    } catch {
      return { ...DEFAULT_HIGH_SCORE };
    }
  }

  saveHighScore(record) {
    const sanitizedRecord = {
      initials: this.sanitizeInitials(record.initials),
      score: this.sanitizeScore(record.score)
    };

    if (typeof window === "undefined" || !window.localStorage) {
      return sanitizedRecord;
    }

    try {
      window.localStorage.setItem(
        HIGH_SCORE_STORAGE_KEY,
        JSON.stringify(sanitizedRecord)
      );
    } catch {
      return sanitizedRecord;
    }

    return sanitizedRecord;
  }

  formatScore(value) {
    return String(this.sanitizeScore(value)).padStart(6, "0");
  }

  getHighScoreText() {
    const initials = this.sanitizeInitials(this.highScore?.initials);
    const score = this.sanitizeScore(this.highScore?.score);
    return `HI ${initials} ${this.formatScore(score)}`;
  }

  cleanupHighScoreInput() {
    if (this.highScoreKeyHandler && this.input?.keyboard) {
      this.input.keyboard.off("keydown", this.highScoreKeyHandler);
      this.highScoreKeyHandler = null;
    }
  }

  updateHighScoreEntryMessage() {
    const titleText =
      this.highScoreEntryMode === "campaignClear"
        ? "ALL LEVELS CLEAR!"
        : "NEW HIGH SCORE!";
    const wheelText = this.initialsChars
      .map((letter, index) =>
        index === this.initialsCursor ? `[${letter}]` : ` ${letter} `
      )
      .join(" ");

    this.messageText.setVisible(true).setText(
      `${titleText}\nSCORE ${this.formatScore(this.score)}\n\n${wheelText}\nARROWS TO EDIT\nENTER TO SAVE`
    );
  }

  startHighScoreEntry(mode = "gameover") {
    this.cleanupHighScoreInput();
    this.highScoreEntryMode = mode;

    this.initialsChars = ["A", "A", "A"];
    this.initialsCursor = 0;
    this.updateHighScoreEntryMessage();

    this.highScoreKeyHandler = (event) => {
      if (!event) {
        return;
      }

      const code = event.code;
      let consumed = true;
      if (code === "ArrowUp") {
        this.stepInitialLetter(1);
      } else if (code === "ArrowDown") {
        this.stepInitialLetter(-1);
      } else if (code === "ArrowLeft") {
        this.initialsCursor = (this.initialsCursor + 2) % 3;
        this.updateHighScoreEntryMessage();
      } else if (code === "ArrowRight") {
        this.initialsCursor = (this.initialsCursor + 1) % 3;
        this.updateHighScoreEntryMessage();
      } else if (code === "Enter" || code === "NumpadEnter") {
        this.submitHighScoreEntry();
      } else {
        consumed = false;
      }

      if (consumed && event.preventDefault) {
        event.preventDefault();
      }
    };

    this.input.keyboard.on("keydown", this.highScoreKeyHandler);
  }

  stepInitialLetter(direction) {
    const alphabetLength = INITIALS_ALPHABET.length;
    const currentLetter = this.initialsChars[this.initialsCursor];
    let currentIndex = INITIALS_ALPHABET.indexOf(currentLetter);
    if (currentIndex < 0) {
      currentIndex = 0;
    }

    const nextIndex =
      (currentIndex + direction + alphabetLength) % alphabetLength;
    this.initialsChars[this.initialsCursor] = INITIALS_ALPHABET[nextIndex];
    this.updateHighScoreEntryMessage();
  }

  submitHighScoreEntry() {
    const initials = this.sanitizeInitials(this.initialsChars.join(""));
    this.highScore = this.saveHighScore({
      initials,
      score: this.score
    });
    this.cleanupHighScoreInput();
    this.updateUiText();

    this.messageText
      .setVisible(true)
      .setText(this.getHighScoreSavedMessage());

    this.time.delayedCall(120, () => {
      this.input.keyboard.once("keydown-ENTER", () => {
        if (this.highScoreEntryMode === "campaignClear") {
          this.scene.start("TitleScene");
          return;
        }
        this.restartLevel();
      });
    });
  }

  getHighScoreSavedMessage() {
    if (this.highScoreEntryMode === "campaignClear") {
      return `ALL LEVELS CLEAR!\nNEW HIGH SCORE\n${this.highScore.initials} ${this.formatScore(
        this.highScore.score
      )}\nPRESS ENTER`;
    }

    return `NEW HIGH SCORE!\n${this.highScore.initials} ${this.formatScore(
      this.highScore.score
    )}\nPRESS ENTER TO RETRY`;
  }

  scheduleLevelWaves() {
    const waves = this.levelConfig.waves ?? [];
    waves.forEach((wave) => {
      for (let i = 0; i < wave.count; i += 1) {
        const delay = wave.atMs + wave.spacingMs * i;
        this.pendingSpawns += 1;
        this.time.delayedCall(delay, () => {
          this.spawnEnemyFromWave(wave, i);
          this.pendingSpawns -= 1;
        });
      }
    });
  }

  spawnEnemyFromWave(wave, index) {
    if (this.isGameOver || this.levelCleared) {
      return;
    }

    const enemyTypeConfig = this.enemyTypes[wave.enemyType];
    if (!enemyTypeConfig) {
      return;
    }

    const spawnX = this.getSpawnX(wave, index, wave.count);
    const enemy = this.enemies
      .create(spawnX, -18, enemyTypeConfig.placeholderTexture)
      .setDepth(2);
    enemy.setScale(this.getTextureScale(enemyTypeConfig.placeholderTexture));

    enemy.body.allowGravity = false;
    enemy.body.setImmovable(true);
    this.applyConfiguredHitbox(enemy, "enemy");

    enemy.setData("enemyTypeId", wave.enemyType);
    enemy.setData("hp", enemyTypeConfig.hp);
    enemy.setData("spawnTime", this.time.now);
    enemy.setData("baseX", spawnX);
    enemy.setData("nextShotAt", this.time.now + 900);
    enemy.setData("isStationary", false);
  }

  getSpawnX(wave, index, totalCount) {
    const margin = Math.max(24, Math.floor(this.scale.width * 0.06));
    const minX = margin;
    const maxX = this.scale.width - margin;
    const laneFractions = {
      wide: [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92],
      center: [0.26, 0.38, 0.5, 0.62, 0.74],
      alternatingEdges: [0.08, 0.92, 0.2, 0.8, 0.32, 0.68, 0.44, 0.56]
    };

    if (wave.lanePattern === "random") {
      return Phaser.Math.Between(minX, maxX);
    }

    const laneValues = laneFractions[wave.lanePattern] ?? laneFractions.wide;
    const lanes = laneValues.map((fraction) =>
      Phaser.Math.Clamp(Math.round(this.scale.width * fraction), minX, maxX)
    );

    if (totalCount <= lanes.length) {
      const spreadIndex = Math.floor((index / Math.max(totalCount - 1, 1)) * (lanes.length - 1));
      return lanes[spreadIndex];
    }

    return lanes[index % lanes.length];
  }

  updatePlayerMovement() {
    const speed = this.playerConfig.moveSpeed;
    this.player.body.setVelocityX(0);

    if (this.cursors.left.isDown) {
      this.player.body.setVelocityX(-speed);
    }
    if (this.cursors.right.isDown) {
      this.player.body.setVelocityX(speed);
    }
  }

  tryPlayerShoot(time) {
    const cooldown = this.playerConfig.fireCooldownMs;
    if (this.weaponHeatConfig.enabled && this.isWeaponOverheated) {
      return;
    }

    if (!this.fireKey.isDown || time < this.nextPlayerShotAt) {
      return;
    }

    this.nextPlayerShotAt = time + cooldown;
    const bullet = this.playerBullets
      .create(this.player.x, this.player.y - 12, "playerLaser")
      .setDepth(2);
    bullet.setScale(this.getTextureScale("playerLaser"));
    bullet.body.allowGravity = false;
    this.applyConfiguredHitbox(bullet, "playerLaser");
    bullet.body.setVelocity(0, -360);
    this.playSfx("playerFire");
    this.applyWeaponHeatFromShot(time);
  }

  updateEnemies(time, delta) {
    const dt = delta / 1000;
    this.enemies.getChildren().forEach((enemy) => {
      if (!enemy.active) {
        return;
      }

      const enemyTypeId = enemy.getData("enemyTypeId");
      const typeConfig = this.enemyTypes[enemyTypeId];
      const movement = typeConfig.movement;

      if (movement === "straight") {
        enemy.y += typeConfig.speed * dt;
      } else if (movement === "zigzag") {
        enemy.y += typeConfig.speed * dt;
        const spawnTime = enemy.getData("spawnTime");
        const baseX = enemy.getData("baseX");
        enemy.x =
          baseX +
          Math.sin((time - spawnTime) * typeConfig.weaveSpeed) *
            typeConfig.weaveAmplitude;
      } else if (movement === "stationary") {
        const stopY = typeConfig.stopY ?? 120;
        const isStationary = enemy.getData("isStationary");
        if (!isStationary) {
          enemy.y += typeConfig.speed * dt;
          if (enemy.y >= stopY) {
            enemy.y = stopY;
            enemy.setData("isStationary", true);
          }
        }
      } else if (movement === "sweeper") {
        enemy.y += typeConfig.speed * dt;
        const spawnTime = enemy.getData("spawnTime");
        const baseX = enemy.getData("baseX");
        enemy.x =
          baseX +
          Math.sin((time - spawnTime) * typeConfig.weaveSpeed) *
            typeConfig.weaveAmplitude;
      }

      if (typeConfig.canShoot) {
        const nextShotAt = enemy.getData("nextShotAt");
        if (time >= nextShotAt) {
          this.fireEnemyBullet(enemy);
          enemy.setData(
            "nextShotAt",
            time + (typeConfig.shootCooldownMs ?? 1200)
          );
        }
      }

      if (enemy.y > this.scale.height + 30) {
        enemy.destroy();
      }
    });
  }

  fireEnemyBullet(enemy) {
    const bullet = this.enemyBullets
      .create(enemy.x, enemy.y + 8, "enemyLaser")
      .setDepth(2);
    bullet.setScale(this.getTextureScale("enemyLaser"));
    bullet.body.allowGravity = false;
    this.applyConfiguredHitbox(bullet, "enemyLaser");
    bullet.body.setVelocity(0, 230);
  }

  handlePlayerBulletHitEnemy(bullet, enemy) {
    if (!bullet.active || !enemy.active) {
      return;
    }

    bullet.destroy();
    this.playSfx("enemyHit");

    const enemyTypeId = enemy.getData("enemyTypeId");
    const typeConfig = this.enemyTypes[enemyTypeId];
    const hp = enemy.getData("hp") - 1;
    enemy.setData("hp", hp);

    if (hp <= 0) {
      this.score += typeConfig.score;
      this.updateUiText();
      enemy.destroy();
    }
  }

  handlePlayerHit(objectA, objectB) {
    if (this.playerInvulnerable || this.isGameOver || this.levelCleared) {
      return;
    }

    const damagingObject = objectA === this.player ? objectB : objectA;
    if (!damagingObject || damagingObject === this.player) {
      return;
    }

    if (damagingObject?.active) {
      damagingObject.destroy();
    }

    this.playSfx("playerHit");
    this.lives -= 1;
    this.updateUiText();

    if (this.lives <= 0) {
      this.triggerGameOver();
      return;
    }

    this.activateTemporaryInvulnerability();
  }

  activateTemporaryInvulnerability() {
    this.playerInvulnerable = true;
    this.player.setTint(0xff5566);

    this.tweens.add({
      targets: this.player,
      alpha: 0.15,
      yoyo: true,
      repeat: 9,
      duration: 50
    });

    this.time.delayedCall(this.playerConfig.invulnerableMs, () => {
      this.playerInvulnerable = false;
      this.player.clearTint();
      this.player.setAlpha(1);
    });
  }

  cleanupOffscreenProjectiles() {
    this.playerBullets.getChildren().forEach((bullet) => {
      if (bullet.active && bullet.y < -20) {
        bullet.destroy();
      }
    });

    this.enemyBullets.getChildren().forEach((bullet) => {
      if (bullet.active && bullet.y > this.scale.height + 20) {
        bullet.destroy();
      }
    });
  }

  checkLevelClearState() {
    if (this.pendingSpawns > 0) {
      return;
    }

    if (this.enemies.countActive(true) > 0) {
      return;
    }

    this.levelCleared = true;
    this.stopWeaponHeatFlash();
    const allLevels = this.cache.json.get(CONFIG_CACHE_KEY)?.levels ?? [];
    const nextLevelIndex = this.levelIndex + 1;
    const hasNextLevel = nextLevelIndex < allLevels.length;

    if (hasNextLevel) {
      this.messageText
        .setVisible(true)
        .setText(
          `LEVEL ${this.levelIndex + 1} CLEAR\nGET READY FOR LEVEL ${
            nextLevelIndex + 1
          }`
        );
      this.time.delayedCall(1800, () => {
        this.scene.start("GameScene", { levelIndex: nextLevelIndex });
      });
      return;
    }

    if (this.score > this.sanitizeScore(this.highScore?.score)) {
      this.startHighScoreEntry("campaignClear");
      return;
    }

    this.messageText.setVisible(true).setText("ALL LEVELS CLEAR\nPRESS ENTER");
    this.input.keyboard.once("keydown-ENTER", () => {
      this.scene.start("TitleScene");
    });
  }

  triggerGameOver() {
    this.isGameOver = true;
    this.stopWeaponHeatFlash();
    this.player.setVisible(false);
    if (this.score > this.sanitizeScore(this.highScore?.score)) {
      this.startHighScoreEntry("gameover");
      return;
    }

    this.messageText.setVisible(true).setText("GAME OVER\nPRESS ENTER TO RETRY");
    this.input.keyboard.once("keydown-ENTER", () => {
      this.restartLevel();
    });
  }

  restartLevel() {
    this.scene.start("GameScene", { levelIndex: this.levelIndex });
  }

  updateUiText() {
    this.scoreText.setText(`SCORE ${this.formatScore(this.score)}`);
    this.highScoreText.setText(this.getHighScoreText());
    this.livesText.setText(`LIVES ${this.lives}`);
  }
}

function getGameDimensions() {
  const fallbackWidth = 360;
  const fallbackHeight = 540;
  const configDimensions = gameConfigData.game ?? {};
  const baseWidth = configDimensions.canvasWidth ?? fallbackWidth;
  const baseHeight = configDimensions.canvasHeight ?? fallbackHeight;
  const maxCanvasWidth = configDimensions.maxCanvasWidth ?? Number.POSITIVE_INFINITY;
  const aspectRatio = baseWidth / baseHeight;

  if (typeof window === "undefined") {
    return {
      width: baseWidth,
      height: baseHeight
    };
  }

  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  const widthFromAspect = Math.round(viewportHeight * aspectRatio);
  const scaledWidth = Math.min(widthFromAspect, viewportWidth, maxCanvasWidth);
  const minimumWidth = Math.min(baseWidth, viewportWidth);

  return {
    width: Math.max(minimumWidth, scaledWidth),
    height: viewportHeight
  };
}

function applyRootSize(dimensions) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.getElementById("game-root");
  if (!root) {
    return;
  }

  root.style.width = `${dimensions.width}px`;
  root.style.height = `${dimensions.height}px`;
}

const dimensions = getGameDimensions();
applyRootSize(dimensions);
const gameConfig = {
  type: Phaser.AUTO,
  parent: "game-root",
  width: dimensions.width,
  height: dimensions.height,
  pixelArt: true,
  backgroundColor: "#000000",
  roundPixels: true,
  physics: {
    default: "arcade",
    arcade: {
      debug: false
    }
  },
  scene: [BootScene, TitleScene, GameScene]
};

const game = new Phaser.Game(gameConfig);
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    const nextDimensions = getGameDimensions();
    applyRootSize(nextDimensions);
    game.scale.resize(nextDimensions.width, nextDimensions.height);
  });
}
