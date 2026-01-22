// app.js (ethers v5) - 365df MLM DApp (User)
// English UI + MetaMask/Bitget/Binance injection support
(() => {
  const C = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);

  const setStatus = (msg) => { const el = $("status"); if (el) el.textContent = msg; };
  const setBuyHint = (msg) => { const el = $("buyHint"); if (el) el.textContent = msg; };

  const isAddr = (s) => /^0x[a-fA-F0-9]{40}$/.test(s || "");
  const checksum = (a) => { try { return ethers.utils.getAddress(a); } catch { return null; } };

  const fmtUnits = (bn, decimals=18, maxFrac=6) => {
    try {
      const s = ethers.utils.formatUnits(bn || 0, decimals);
      const [i,f=""] = s.split(".");
      return f.length ? `${i}.${f.slice(0, maxFrac)}` : i;
    } catch { return "-"; }
  };

  const nowSec = () => Math.floor(Date.now()/1000);

  const PKG_LABEL = ["Small","Medium","Large"];
  const RANK_LABEL = ["None","Bronze","Silver","Gold"];

  let injected, provider, signer, user;
  let core, vault, staking, usdt, df, payout, binary;

  let selectedPkg = null; // 0/1/2
  let sponsor = null;     // address
  let sideRight = null;   // boolean

  let countdownTimer = null;

  // --- detect injected provider ---
  function detectInjected() {
    // Most wallets: window.ethereum
    if (window.ethereum) return window.ethereum;
    // Older Binance: window.BinanceChain (fallback)
    if (window.BinanceChain) return window.BinanceChain;
    return null;
  }

  // --- network ensure BSC ---
  async function ensureBSC() {
    const net = await provider.getNetwork();
    $("network").textContent = `${net.chainId}`;
    if (net.chainId === C.CHAIN_ID_DEC) {
      $("network").textContent = "BSC (56)";
      return;
    }

    if (!injected?.request) {
      throw new Error("Wrong network. Please switch to BSC Mainnet and retry.");
    }

    try {
      await injected.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: C.CHAIN_ID_HEX }]
      });
    } catch (e) {
      throw new Error("Please switch your wallet network to BSC Mainnet, then try again.");
    }
  }

  // --- URL ref/side ---
  function readRefFromURL() {
    const u = new URL(window.location.href);
    const ref = u.searchParams.get("ref");
    const side = (u.searchParams.get("side") || "").toUpperCase();

    sponsor = isAddr(ref) ? checksum(ref) : null;

    if (side === "R") sideRight = true;
    else if (side === "L") sideRight = false;
    else sideRight = null;

    $("sponsor").textContent = sponsor || "-";
    $("sideText").textContent = sideRight === null ? "-" : (sideRight ? "Right" : "Left");
  }

  function updateBuyButtonState() {
    const ok =
      !!user &&
      selectedPkg !== null &&
      isAddr(sponsor) &&
      (sideRight === true || sideRight === false);

    $("btnApproveBuy").disabled = !ok;
    if (!user) setBuyHint("Connect your wallet first.");
    else if (selectedPkg === null) setBuyHint("Select a package.");
    else if (!isAddr(sponsor)) setBuyHint("Open via referral link or paste sponsor address in URL (?ref=0x...&side=L/R).");
    else if (sideRight !== true && sideRight !== false) setBuyHint("Select a side (Left/Right).");
    else setBuyHint("Ready. Approve USDT then Buy/Upgrade.");
  }

  function enableActions(on) {
    $("btnRefresh").disabled = !on;
    $("btnClaimBonus").disabled = !on;
    $("btnClaimStake").disabled = !on;
    $("btnCopyL").disabled = !on;
    $("btnCopyR").disabled = !on;
  }

  function setContractsLine() {
    $("contractsLine").textContent =
      `CORE: ${C.CORE} • VAULT: ${C.VAULT} • STAKING: ${C.STAKING} • PAYOUT: ${C.PAYOUT} • BINARY: ${C.BINARY}`;
  }

  // --- bind UI ---
  function bindUI() {
    $("btnConnect").addEventListener("click", connect);

    $("btnSideL").addEventListener("click", () => {
      sideRight = false;
      $("sideText").textContent = "Left";
      setStatus("Selected side: Left");
      updateBuyButtonState();
    });
    $("btnSideR").addEventListener("click", () => {
      sideRight = true;
      $("sideText").textContent = "Right";
      setStatus("Selected side: Right");
      updateBuyButtonState();
    });

    document.querySelectorAll(".pkg").forEach(btn => {
      btn.addEventListener("click", () => {
        selectedPkg = Number(btn.getAttribute("data-pkg"));
        $("selectedPkg").textContent = PKG_LABEL[selectedPkg] || "-";
        setStatus(`Selected package: ${PKG_LABEL[selectedPkg]}`);
        updateBuyButtonState();
      });
    });

    $("btnApproveBuy").addEventListener("click", approveAndBuy);
    $("btnClaimBonus").addEventListener("click", claimBonus);
    $("btnClaimStake").addEventListener("click", claimStake);
    $("btnRefresh").addEventListener("click", refresh);

    $("btnCopyL").addEventListener("click", () => copyMyLink("L"));
    $("btnCopyR").addEventListener("click", () => copyMyLink("R"));
  }

  async function copyMyLink(side) {
    if (!user) return;
    const base = window.location.origin + window.location.pathname;
    const url = `${base}?ref=${user}&side=${side}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus(`Copied: ${side} link ✅`);
    } catch {
      // fallback
      prompt("Copy this link:", url);
    }
  }

  // --- connect ---
  async function connect() {
    try {
      injected = detectInjected();
      if (!injected) {
        setStatus("No wallet detected. Please open this page in a wallet DApp browser (MetaMask / Bitget / Binance).");
        return;
      }

      provider = new ethers.providers.Web3Provider(injected, "any");
      await provider.send("eth_requestAccounts", []);
      signer = provider.getSigner();

      user = checksum(await signer.getAddress());
      if (!user) throw new Error("Cannot read wallet address.");

      await ensureBSC();

      // Contracts (signer for write, provider for read if needed)
      core   = new ethers.Contract(C.CORE,   C.CORE_ABI,   signer);
      vault  = new ethers.Contract(C.VAULT,  C.VAULT_ABI,  signer);
      staking= new ethers.Contract(C.STAKING,C.STAKING_ABI,signer);

      usdt   = new ethers.Contract(C.USDT, C.ERC20_ABI, signer);
      df     = new ethers.Contract(C.DF,   C.ERC20_ABI, signer);

      payout = new ethers.Contract(C.PAYOUT, C.PAYOUT_ABI, provider);
      binary = new ethers.Contract(C.BINARY, C.BINARY_ABI, provider);

      $("wallet").textContent = user; // show full address (fix: not short)
      setContractsLine();
      enableActions(true);

      setStatus("Connected ✅");

      // listeners
      if (injected.on) {
        injected.on("accountsChanged", async (accs) => {
          if (!accs?.length) return;
          user = checksum(accs[0]);
          $("wallet").textContent = user || "-";
          setStatus("Account changed ✅");
          await refresh();
          updateBuyButtonState();
        });

        injected.on("chainChanged", async () => {
          setStatus("Network changed. Refreshing...");
          // provider network refresh
          provider = new ethers.providers.Web3Provider(injected, "any");
          signer = provider.getSigner();
          await ensureBSC();
          await refresh();
        });
      }

      // Initial refresh
      await refresh();
      updateBuyButtonState();
    } catch (e) {
      setStatus(`Connect failed: ${friendlyErr(e)}`);
    }
  }

  // --- buy flow ---
  async function approveAndBuy() {
    try {
      if (!user) throw new Error("Please connect wallet first.");
      if (selectedPkg === null) throw new Error("Please select a package.");
      if (!isAddr(sponsor)) throw new Error("Sponsor address is missing/invalid. Open using referral link.");
      if (sideRight !== true && sideRight !== false) throw new Error("Please select a side (Left/Right).");

      const price = await core.priceUSDT(selectedPkg); // pure in contract but callable
      const allowance = await usdt.allowance(user, C.CORE);

      if (allowance.lt(price)) {
        setStatus("Approving USDT...");
        const txA = await usdt.approve(C.CORE, price);
        setStatus(`Approve submitted: ${txLink(txA.hash)}`);
        await txA.wait();
      }

      setStatus("Buying / Upgrading...");
      const tx = await core.buyOrUpgrade(selectedPkg, sponsor, sideRight);
      setStatus(`Buy submitted: ${txLink(tx.hash)}`);
      await tx.wait();

      setStatus("Buy/Upgrade success ✅");
      await refresh();
    } catch (e) {
      setStatus(`Buy failed: ${friendlyErr(e)}`);
    }
  }

  // --- claim bonus (vault) ---
  async function claimBonus() {
    try {
      if (!user) throw new Error("Connect wallet first.");
      setStatus("Claiming bonus...");
      const tx = await vault.claim();
      setStatus(`Claim submitted: ${txLink(tx.hash)}`);
      await tx.wait();
      setStatus("Claim Bonus success ✅");
      await refresh();
    } catch (e) {
      setStatus(`Claim failed: ${friendlyErr(e)}`);
    }
  }

  // --- claim stake (staking) ---
  async function claimStake() {
    try {
      if (!user) throw new Error("Connect wallet first.");
      setStatus("Claiming stake...");
      const tx = await staking.claimStake();
      setStatus(`Claim submitted: ${txLink(tx.hash)}`);
      await tx.wait();
      setStatus("Claim Stake success ✅");
      await refresh();
    } catch (e) {
      setStatus(`Claim stake failed: ${friendlyErr(e)}`);
    }
  }

  // --- refresh dashboard ---
  async function refresh() {
    try {
      if (!user || !core) return;

      // Core user data
      const u = await core.users(user);
      const pkg = Number(u.pkg);
      const rank = Number(u.rank);

      $("kpiPkg").textContent = (pkg >= 0 && pkg <= 2) ? PKG_LABEL[pkg] : "None";
      $("kpiRank").textContent = (rank >= 0 && rank <= 3) ? RANK_LABEL[rank] : "None";

      // Sponsor/side auto from contract (if registered)
      const sp = await core.sponsorOf(user);
      if (sp && sp !== ethers.constants.AddressZero) {
        $("sponsor").textContent = sp;
      }
      try {
        const sr = await core.sideRightOf(user);
        if (typeof sr === "boolean") $("sideText").textContent = sr ? "Right" : "Left";
      } catch {}

      // Vault earns
      const earns = await vault.earns(user);
      $("kpiClaimUSDT").textContent = fmtUnits(earns.claimUSDT, 18, 6);
      $("kpiClaimDF").textContent = fmtUnits(earns.claimDF, 18, 6);

      // Vault surplus
      const surplus = await vault.surplusUSDT();
      $("kpiSurplus").textContent = fmtUnits(surplus, 18, 6);

      // Core treasury
      const tre = await core.treasury();
      $("kpiTreasury").textContent = tre;

      // Staking data
      const st = await staking.stakes(user);
      $("kpiPrincipal").textContent = fmtUnits(st.principal, 18, 6);

      const pending = await staking.pendingReward(user);
      $("kpiPending").textContent = fmtUnits(pending, 18, 6);

      const end = Number(st.end);
      if (end > 0) {
        $("kpiStakeEnd").textContent = new Date(end * 1000).toLocaleString();
        startCountdown(end);
      } else {
        $("kpiStakeEnd").textContent = "-";
        $("kpiCountdown").textContent = "-";
        stopCountdown();
      }

      // Binary volumes (read-only)
      try {
        const vols = await binary.volumesOf(user);
        $("kpiVolL").textContent = fmtUnits(vols.l, 18, 4);
        $("kpiVolR").textContent = fmtUnits(vols.r, 18, 4);
      } catch {
        $("kpiVolL").textContent = "-";
        $("kpiVolR").textContent = "-";
      }

      setStatus("Refreshed ✅");
    } catch (e) {
      setStatus(`Refresh error: ${friendlyErr(e)}`);
    }
  }

  // --- countdown ---
  function stopCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = null;
  }

  function startCountdown(endSec) {
    stopCountdown();
    const tick = () => {
      const diff0 = endSec - nowSec();
      if (diff0 <= 0) {
        $("kpiCountdown").textContent = "Matured ✅";
        return;
      }
      let diff = diff0;
      const d = Math.floor(diff / 86400); diff -= d * 86400;
      const h = Math.floor(diff / 3600);  diff -= h * 3600;
      const m = Math.floor(diff / 60);    diff -= m * 60;
      const s = diff;
      $("kpiCountdown").textContent = `${d}d ${h}h ${m}m ${s}s`;
    };
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  // --- errors + tx links ---
  function friendlyErr(e) {
    const msg =
      e?.error?.message ||
      e?.data?.message ||
      e?.reason ||
      e?.message ||
      String(e);

    // common wallet cancel
    if (/user rejected/i.test(msg)) return "User rejected the transaction.";
    return msg;
  }

  function txLink(hash) {
    if (!hash) return "";
    const url = `${C.BLOCK_EXPLORER}/tx/${hash}`;
    return `Tx: ${hash.slice(0,10)}… (${url})`;
  }

  // init
  function init() {
    readRefFromURL();
    bindUI();
    setContractsLine();
    updateBuyButtonState();
    enableActions(false);
    setBuyHint("Connect your wallet first.");
  }

  init();
})();
