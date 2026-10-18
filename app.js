/**
 * LIÊN QUÂN MOBILE - ACCOUNT BANNER GENERATOR
 * Full Application Logic (Cropping, Matrix Table, Banner Layout, 4K Composite Export)
 */

document.addEventListener('DOMContentLoaded', () => {
  // Global Application State
  const state = {
    catalog: null,            // { tiers, heroes, matrix, skins, total_skins }
    selectedSkins: new Set(), // Set of skin IDs
    uploadedImages: [],       // [ { id, name, dataUrl, file } ]
    croppedParts: {},         // { slot_id: { dataUrl, width, height, name, slotName } }
    cropperInstance: null,
    currentCropImgIndex: 0,
    bannerRows: 6,
    bannerRowsMode: 'auto',   // 'auto' | 'fixed'
    bannerRowsFixed: 6,
    bannerCols: 15,
    bannerSlots: [],          // Array of slot objects representing the banner grid
    profileLayout: 'big_2x2', // Default: 'big_2x2' | 'standard' | 'wide_2x1'
    sortMode: 'tier',        // Default: 'tier' | 'smart' | 'hero' | 'theme'
    zoomCardW: 160,           // Preview zoom width (120, 160, 195, 230)
    activeTab: 'tab-crop',
    excludeTiers: {
      a: false,
      rank: false,
      s: false,
      ssm: false,
      splus: false
    }
  };

  // DOM Elements
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingText = document.getElementById('loading-text');
  const selectedSkinsCountEl = document.getElementById('selected-skins-count');
  const croppedCountEl = document.getElementById('cropped-count');

  // Tab Navigation
  const stepTabs = document.querySelectorAll('.step-tab');
  const tabPanes = document.querySelectorAll('.tab-pane');

  stepTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      switchTab(targetTab);
    });
  });

  function switchTab(tabId) {
    state.activeTab = tabId;
    document.body.setAttribute('data-active-tab', tabId);
    stepTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tabId));
    tabPanes.forEach(p => p.classList.toggle('active', p.id === tabId));
    if (tabId === 'tab-banner') {
      arrangeSkinsToBanner();
      renderBannerGrid();
    }
  }

  // Initialize active tab attribute
  document.body.setAttribute('data-active-tab', 'tab-crop');

  // Quick export button on header
  document.getElementById('btn-quick-export').addEventListener('click', () => {
    switchTab('tab-banner');
    setTimeout(() => {
      exportBannerCanvas();
    }, 300);
  });

  // =========================================================================
  // 1. DATA INITIALIZATION
  // =========================================================================
  async function loadData() {
    try {
      const isGitHub = window.location.hostname.includes('github.io') || window.location.protocol === 'file:';
      let res;
      if (isGitHub) {
        res = await fetch('./catalog.json');
      } else {
        try {
          res = await fetch('/api/data');
          if (!res.ok) throw new Error('Not ok');
        } catch (e) {
          res = await fetch('./catalog.json');
        }
      }
      if (!res.ok) throw new Error('Không thể tải catalog skin');
      const data = await res.json();

      // Chuẩn hóa toàn bộ web_path sang đường dẫn tương đối (./skins/...) để tương thích GitHub Pages
      const fixWebPath = (p) => (typeof p === 'string' && p.startsWith('/skins/')) ? ('.' + p) : p;
      if (Array.isArray(data.skins)) {
        data.skins.forEach(s => { s.web_path = fixWebPath(s.web_path); });
      }
      if (data.matrix) {
        Object.keys(data.matrix).forEach(tierKey => {
          const tierObj = data.matrix[tierKey];
          Object.keys(tierObj).forEach(heroKey => {
            const list = tierObj[heroKey];
            if (Array.isArray(list)) {
              list.forEach(s => { s.web_path = fixWebPath(s.web_path); });
            }
          });
        });
      }
      if (Array.isArray(data.heroes)) {
        data.heroes.forEach(h => {
          h.avatar = fixWebPath(h.avatar);
        });
      }

      state.catalog = data;
      console.log("[Data Loaded]", data);

      initMatrixTable();
      initTierPills();
      applyFilters();
      buildInitialBannerSlots();
      if (typeof preloadStatIcons === 'function') await preloadStatIcons();
      await applyAutoCards();
      loadingOverlay.classList.add('hidden');
    } catch (err) {
      console.error(err);
      loadingText.innerHTML = `<span style="color:#ff4444;">Lỗi tải dữ liệu: ${err.message}.<br>Vui lòng đảm bảo server.py đang chạy!</span>`;
    }
  }

  // =========================================================================
  // 2. TAB 1: NHẬP VÀ CẮT ẢNH KIỂU (PROFILE SCREENSHOT CROPPER)
  // =========================================================================
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const uploadedList = document.getElementById('uploaded-list');
  const uploadCountEl = document.getElementById('upload-count');
  const croppedGallery = document.getElementById('cropped-gallery');

  const cropModal = document.getElementById('crop-modal');
  const cropperImg = document.getElementById('cropper-image');
  const btnCloseModal = document.getElementById('btn-close-modal');
  const btnApplyCrop = document.getElementById('btn-apply-crop');
  const btnNextCrop = document.getElementById('btn-next-crop');
  const cropTargetSlot = document.getElementById('crop-target-slot');
  const customSlotWrap = document.getElementById('custom-slot-picker-wrap');
  const customSlotNum = document.getElementById('custom-slot-num');

  // Dropzone Events
  dropzone.addEventListener('click', () => fileInput.click());
  document.getElementById('btn-add-more-img').addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  });

  function handleFiles(files) {
    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (validFiles.length === 0) return;

    let loadedCount = 0;
    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        state.uploadedImages.push({
          id: 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          name: file.name,
          dataUrl: e.target.result,
          file: file
        });
        loadedCount++;
        if (loadedCount === validFiles.length) {
          updateUploadedImagesUI();
        }
      };
      reader.readAsDataURL(file);
    });
  }

  function updateUploadedImagesUI() {
    uploadCountEl.textContent = state.uploadedImages.length;
    if (state.uploadedImages.length === 0) {
      uploadedList.innerHTML = `<div class="empty-state">Chưa có ảnh nào được tải lên. Hãy tải ít nhất 1 ảnh chụp màn hình (như ảnh Thông tin kiện tướng).</div>`;
      return;
    }

    uploadedList.innerHTML = state.uploadedImages.map((img, idx) => `
      <div class="upload-card">
        <img class="upload-card-thumb" src="${img.dataUrl}" alt="${img.name}">
        <div class="upload-card-info">
          <div class="upload-card-title" title="${img.name}">Ảnh #${idx + 1}: ${img.name}</div>
          <div class="upload-card-actions">
            <button class="btn btn-small btn-primary" onclick="window.startCropIndex(${idx})">
              ✂️ Cắt Ảnh Này
            </button>
            <button class="btn btn-small btn-danger-outline" onclick="window.deleteUploadIndex(${idx})">
              🗑️ Xóa
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  window.deleteUploadIndex = (idx) => {
    state.uploadedImages.splice(idx, 1);
    updateUploadedImagesUI();
  };

  document.getElementById('btn-clear-images').addEventListener('click', () => {
    if (confirm('Bạn có chắc muốn xóa tất cả ảnh đã tải lên?')) {
      state.uploadedImages = [];
      updateUploadedImagesUI();
    }
  });

  // Batch Crop ("Cắt lần lượt")
  document.getElementById('btn-batch-crop').addEventListener('click', () => {
    if (state.uploadedImages.length === 0) {
      alert('Vui lòng tải lên ít nhất 1 ảnh chụp màn hình trước!');
      fileInput.click();
      return;
    }
    window.startCropIndex(0);
  });

  // Start Crop on Image
  window.startCropIndex = (idx) => {
    if (idx < 0 || idx >= state.uploadedImages.length) return;
    state.currentCropImgIndex = idx;
    const imgItem = state.uploadedImages[idx];

    // Auto set target slot recommendation based on how many parts already cropped
    const croppedKeys = Object.keys(state.croppedParts);
    if (!croppedKeys.includes('slot_avatar')) {
      cropTargetSlot.value = 'slot_avatar';
      setCropRatio(0.6371);
    } else if (!croppedKeys.includes('slot_hero')) {
      cropTargetSlot.value = 'slot_hero';
      setCropRatio(0.6371);
    } else if (!croppedKeys.includes('slot_stats')) {
      cropTargetSlot.value = 'slot_stats';
      setCropRatio(1.2742);
    }

    cropperImg.src = imgItem.dataUrl;
    cropModal.classList.add('active');

    if (state.cropperInstance) {
      state.cropperInstance.destroy();
    }

    setTimeout(() => {
      const currentRatio = parseFloat(document.querySelector('.btn-ratio.active')?.getAttribute('data-ratio') || '0.6371');
      state.cropperInstance = new Cropper(cropperImg, {
        aspectRatio: isNaN(currentRatio) ? NaN : currentRatio,
        viewMode: 1,
        autoCropArea: 0.7,
        responsive: true,
        background: false
      });
    }, 150);
  };

  // Ratio Buttons
  const ratioButtons = document.querySelectorAll('.btn-ratio');
  ratioButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      ratioButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const ratio = parseFloat(btn.getAttribute('data-ratio'));
      if (state.cropperInstance) {
        state.cropperInstance.setAspectRatio(isNaN(ratio) ? NaN : ratio);
      }
    });
  });

  function setCropRatio(ratio) {
    ratioButtons.forEach(b => {
      const r = parseFloat(b.getAttribute('data-ratio'));
      b.classList.toggle('active', (!isNaN(r) && Math.abs(r - ratio) < 0.05) || (isNaN(r) && isNaN(ratio)));
    });
    if (state.cropperInstance) {
      state.cropperInstance.setAspectRatio(isNaN(ratio) ? NaN : ratio);
    }
  }

  cropTargetSlot.addEventListener('change', () => {
    const val = cropTargetSlot.value;
    customSlotWrap.style.display = val === 'slot_custom' ? 'block' : 'none';
    if (val === 'slot_big_profile') {
      setCropRatio(0.6371); // 1:1.57 (same aspect ratio, but spans 2x2)
    } else if (val === 'slot_stats' || val === 'slot_avatar_wide') {
      setCropRatio(1.2742); // 2:1.57 double slot
    } else if (val === 'slot_avatar' || val === 'slot_hero' || val === 'slot_top_right') {
      setCropRatio(0.6371); // 1:1.57 single slot
    }
  });

  btnCloseModal.addEventListener('click', () => {
    cropModal.classList.remove('active');
    if (state.cropperInstance) state.cropperInstance.destroy();
  });

  // Apply Crop Action
  btnApplyCrop.addEventListener('click', () => {
    saveCurrentCrop(false);
  });

  btnNextCrop.addEventListener('click', () => {
    saveCurrentCrop(true);
  });

  function saveCurrentCrop(goToNext = false) {
    if (!state.cropperInstance) return;

    let targetWidth = 230;
    let targetHeight = 361;
    let slotId = cropTargetSlot.value;
    let slotName = "Ô Thẻ";

    if (slotId === 'slot_big_profile') {
      targetWidth = 460;
      targetHeight = 722;
      slotName = "⭐ Khối Lớn 2x2 (To Rõ Nhất)";
    } else if (slotId === 'slot_avatar') {
      slotName = "Avatar & Tên (Ô 1)";
    } else if (slotId === 'slot_avatar_wide') {
      targetWidth = 462;
      slotName = "Avatar & Tên Đôi 2x1";
    } else if (slotId === 'slot_hero') {
      slotName = "Tướng Tủ (Ô 2)";
    } else if (slotId === 'slot_tuong_skin') {
      slotName = "Số Tướng & Trang Phục (Bên phải Khối 2x2 - Trên)";
    } else if (slotId === 'slot_tai_nguyen' || slotId === 'slot_winrate' || slotId === 'slot_stats') {
      slotName = "Tài Nguyên (Bên phải Khối 2x2 - Dưới)";
    } else if (slotId === 'slot_top_right') {
      slotName = "Góc Trên Phải (Ô 15)";
    } else if (slotId === 'slot_custom') {
      const customNum = parseInt(customSlotNum.value) || 1;
      slotId = 'slot_' + customNum;
      slotName = `Ô Tự Chọn #${customNum}`;
    }

    const canvas = state.cropperInstance.getCroppedCanvas({
      width: targetWidth * 2, // 2x supersampling for high resolution
      height: targetHeight * 2,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high'
    });

    const dataUrl = canvas.toDataURL('image/png');

    state.croppedParts[slotId] = {
      slotId: slotId,
      slotName: slotName,
      dataUrl: dataUrl,
      width: targetWidth,
      height: targetHeight,
      imgSource: state.uploadedImages[state.currentCropImgIndex]?.name || 'Crop'
    };

    updateCroppedGalleryUI();
    applyCropToBannerSlot(slotId, dataUrl, slotName);

    if (goToNext && state.currentCropImgIndex + 1 < state.uploadedImages.length) {
      window.startCropIndex(state.currentCropImgIndex + 1);
    } else {
      cropModal.classList.remove('active');
      if (state.cropperInstance) state.cropperInstance.destroy();
      // Highlight banner tab notification
      document.querySelector('.step-tab[data-tab="tab-skins"]').click();
    }
  }

  function updateCroppedGalleryUI() {
    const keys = Object.keys(state.croppedParts);
    croppedCountEl.textContent = keys.length;

    if (keys.length === 0) {
      croppedGallery.innerHTML = `<div class="empty-state">Chưa có mảnh nào được cắt. Bấm "Cắt ảnh này" ở danh sách trên để cắt Avatar hoặc Bảng thông số.</div>`;
      return;
    }

    croppedGallery.innerHTML = keys.map(k => {
      const part = state.croppedParts[k];
      return `
        <div class="cropped-item-card">
          <img class="cropped-item-thumb" src="${part.dataUrl}" alt="${part.slotName}">
          <div class="cropped-item-slot-tag">${part.slotName}</div>
          <button class="cropped-item-del" onclick="window.removeCroppedPart('${k}')">✕ Gỡ bỏ</button>
        </div>
      `;
    }).join('');
  }

  window.removeCroppedPart = (slotId) => {
    delete state.croppedParts[slotId];
    updateCroppedGalleryUI();
    // Remove from banner slot
    const slot = state.bannerSlots.find(s => s.slotId === slotId);
    if (slot) {
      slot.type = 'empty';
      delete slot.dataUrl;
      delete slot.slotName;
      renderBannerGrid();
    }
  };

  function applyCropToBannerSlot(slotId, dataUrl, slotName) {
    if (slotId === 'slot_big_profile') {
      state.profileLayout = 'big_2x2';
      const sel = document.getElementById('profile-layout-style');
      if (sel) sel.value = 'big_2x2';
      buildInitialBannerSlots(true);
      const slot = state.bannerSlots.find(s => s.row === 0 && s.col === 0);
      if (slot) {
        slot.type = 'crop';
        slot.slotId = slotId;
        slot.dataUrl = dataUrl;
        slot.slotName = slotName;
        slot.colspan = 2;
        slot.rowspan = 2;
      }
      applyAutoCards();
      arrangeSkinsToBanner();
    } else if (slotId === 'slot_avatar_wide') {
      state.profileLayout = 'wide_2x1';
      const sel = document.getElementById('profile-layout-style');
      if (sel) sel.value = 'wide_2x1';
      buildInitialBannerSlots(false);
      const slot = state.bannerSlots.find(s => s.row === 0 && s.col === 0);
      if (slot) {
        slot.type = 'crop';
        slot.slotId = slotId;
        slot.dataUrl = dataUrl;
        slot.slotName = slotName;
        slot.colspan = 2;
        slot.rowspan = 1;
      }
      arrangeSkinsToBanner();
    } else if (slotId === 'slot_avatar') {
      const slot = state.bannerSlots.find(s => s.row === 0 && s.col === 0);
      if (slot) {
        slot.type = 'crop';
        slot.slotId = slotId;
        slot.dataUrl = dataUrl;
        slot.slotName = slotName;
      }
    } else if (slotId === 'slot_hero') {
      const slot = state.bannerSlots.find(s => s.row === 0 && s.col === 1);
      if (slot) {
        slot.type = 'crop';
        slot.slotId = slotId;
        slot.dataUrl = dataUrl;
        slot.slotName = slotName;
      }
    } else if (slotId === 'slot_tuong_skin') {
      let slot = null;
      if (state.profileLayout === 'big_2x2') {
        slot = state.bannerSlots.find(s => s.row === 0 && s.col === 2);
      } else {
        slot = state.bannerSlots.find(s => s.row === 0 && s.col === 1) || state.bannerSlots.find(s => s.row === 1 && s.col === 0);
      }
      if (slot) {
        slot.type = 'crop';
        slot.slotId = slotId;
        slot.dataUrl = dataUrl;
        slot.slotName = slotName;
        slot.colspan = 1;
        slot.rowspan = 1;
      }
    } else if (slotId === 'slot_tai_nguyen' || slotId === 'slot_winrate' || slotId === 'slot_stats') {
      let slot = null;
      if (state.profileLayout === 'big_2x2') {
        slot = state.bannerSlots.find(s => s.row === 1 && s.col === 2);
      } else {
        slot = state.bannerSlots.find(s => s.row === 1 && s.col === 1) || state.bannerSlots.find(s => s.row === 0 && s.col === 14);
      }
      if (slot) {
        slot.type = 'crop';
        slot.slotId = slotId;
        slot.dataUrl = dataUrl;
        slot.slotName = slotName;
        slot.colspan = 1;
        slot.rowspan = 1;
      }
    } else if (slotId === 'slot_top_right') {
      const slot = state.bannerSlots.find(s => s.row === 0 && s.col === 14);
      if (slot) {
        slot.type = 'crop';
        slot.slotId = slotId;
        slot.dataUrl = dataUrl;
        slot.slotName = slotName;
      }
    } else if (slotId.startsWith('slot_')) {
      const num = parseInt(slotId.replace('slot_', '')) - 1;
      if (num >= 0 && num < state.bannerSlots.length) {
        const slot = state.bannerSlots[num];
        slot.type = 'crop';
        slot.slotId = slotId;
        slot.dataUrl = dataUrl;
        slot.slotName = slotName;
      }
    }
    renderBannerGrid();
  }

  // =========================================================================
  // 2.1. AUTO-GENERATED PROFILE CARDS: TƯỚNG/SKIN (Ô 3) & TÀI NGUYÊN (Ô 4)
  // =========================================================================
  let cachedTuongImg = null;
  let cachedSkinImg = null;
  let cachedQuanHuyImg = null;
  let cachedTheDoiTenImg = null;
  let cachedVangImg = null;
  let cachedRubyImg = null;

  function preloadStatIcons() {
    return new Promise((resolve) => {
      let loaded = 0;
      const total = 6;
      const checkDone = () => {
        loaded++;
        if (loaded >= total) resolve();
      };

      cachedTuongImg = new Image();
      cachedSkinImg = new Image();
      cachedQuanHuyImg = new Image();
      cachedTheDoiTenImg = new Image();
      cachedVangImg = new Image();
      cachedRubyImg = new Image();

      [cachedTuongImg, cachedSkinImg, cachedQuanHuyImg, cachedTheDoiTenImg, cachedVangImg, cachedRubyImg].forEach(img => {
        img.onload = checkDone;
        img.onerror = checkDone;
      });

      cachedTuongImg.src = './img/tuong.png';
      cachedSkinImg.src = './img/trang%20phuc.png';
      cachedQuanHuyImg.src = './img/quan_huy.png';
      cachedTheDoiTenImg.src = './img/the_doi_ten.png';
      cachedVangImg.src = './img/vang.png';
      cachedRubyImg.src = './img/ruby.png';
    });
  }

  // Generate Ô 3: Số Tướng & Trang Phục (460 x 722 px)
  function generateTuongSkinCard(heroCount, skinCount) {
    const canvas = document.createElement('canvas');
    canvas.width = 460;
    canvas.height = 722;
    const ctx = canvas.getContext('2d');

    // Navy gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 722);
    grad.addColorStop(0, '#0c1c48');
    grad.addColorStop(1, '#050c20');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 460, 722);

    // Neon blue border
    ctx.strokeStyle = '#1872ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 456, 718);

    // Middle divider line
    ctx.beginPath();
    ctx.moveTo(15, 361);
    ctx.lineTo(445, 361);
    ctx.strokeStyle = '#1872ff';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.textBaseline = 'top';

    // Top: Số Tướng
    ctx.fillStyle = '#e1f2ff';
    ctx.font = 'italic 600 42px "Segoe UI", "Rajdhani", sans-serif';
    ctx.fillText('Số Tướng', 45, 45);

    if (cachedTuongImg && cachedTuongImg.complete && cachedTuongImg.naturalWidth > 0) {
      ctx.drawImage(cachedTuongImg, 45, 135, 96, 96);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 96px "Segoe UI", "Rajdhani", sans-serif';
    ctx.fillText(String(heroCount || 0), 175, 130);

    // Bottom: Trang Phục
    ctx.fillStyle = '#e1f2ff';
    ctx.font = 'italic 600 42px "Segoe UI", "Rajdhani", sans-serif';
    ctx.fillText('Trang Phục', 45, 361 + 45);

    if (cachedSkinImg && cachedSkinImg.complete && cachedSkinImg.naturalWidth > 0) {
      ctx.drawImage(cachedSkinImg, 45, 361 + 135, 96, 96);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 96px "Segoe UI", "Rajdhani", sans-serif';
    ctx.fillText(String(skinCount || 0), 175, 361 + 130);

    return canvas.toDataURL('image/png');
  }

  // Generate Ô 4: Tài Nguyên (Quân Huy, Thẻ Đổi Tên, Vàng, Ruby) (460 x 722 px)
  function generateTaiNguyenCard(quanHuy, theDoiTen, vang, ruby) {
    const canvas = document.createElement('canvas');
    canvas.width = 460;
    canvas.height = 722;
    const ctx = canvas.getContext('2d');

    // Navy gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 722);
    grad.addColorStop(0, '#0c1c48');
    grad.addColorStop(1, '#050c20');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 460, 722);

    // Neon blue border
    ctx.strokeStyle = '#1872ff';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 456, 718);

    const items = [
      { name: 'Quân Huy', img: cachedQuanHuyImg, val: String(quanHuy ?? '1580') },
      { name: 'Thẻ Đổi Tên', img: cachedTheDoiTenImg, val: String(theDoiTen ?? '12') },
      { name: 'Vàng', img: cachedVangImg, val: String(vang ?? '125k') },
      { name: 'Ruby', img: cachedRubyImg, val: String(ruby ?? '3400') }
    ];

    const rowH = 722 / 4;
    ctx.textBaseline = 'top';

    items.forEach((item, i) => {
      const ry = i * rowH;

      // Divider line
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(15, ry);
        ctx.lineTo(445, ry);
        ctx.strokeStyle = '#1872ff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Title
      ctx.fillStyle = '#e1f2ff';
      ctx.font = 'italic 600 30px "Segoe UI", "Rajdhani", sans-serif';
      ctx.fillText(item.name, 35, ry + 16);

      // Icon (fitted inside 76x76)
      if (item.img && item.img.complete && item.img.naturalWidth > 0) {
        const iw = item.img.naturalWidth;
        const ih = item.img.naturalHeight;
        const scale = Math.min(76 / iw, 76 / ih);
        const nw = iw * scale;
        const nh = ih * scale;
        const ix = 35 + (76 - nw) / 2;
        const iy = ry + 62 + (76 - nh) / 2;
        ctx.drawImage(item.img, ix, iy, nw, nh);
      }

      // Value text
      ctx.fillStyle = '#ffffff';
      const textLen = item.val.length;
      const fontSize = textLen > 6 ? 48 : 60;
      ctx.font = `bold ${fontSize}px "Segoe UI", "Rajdhani", sans-serif`;
      const numY = ry + 62 + (76 - fontSize) / 2;
      ctx.fillText(item.val, 140, numY);
    });

    return canvas.toDataURL('image/png');
  }

  // Apply both auto cards to Banner
  async function applyAutoCards() {
    const heroInput = document.getElementById('auto-hero-count');
    const skinInput = document.getElementById('auto-skin-count');
    const heroCount = heroInput ? (parseInt(heroInput.value) || 0) : 126;
    const skinCount = skinInput ? (parseInt(skinInput.value) || 0) : 406;

    const qhInput = document.getElementById('auto-quan-huy');
    const tdtInput = document.getElementById('auto-the-doi-ten');
    const vangInput = document.getElementById('auto-vang');
    const rubyInput = document.getElementById('auto-ruby');

    const valQH = qhInput ? qhInput.value.trim() : '1580';
    const valTDT = tdtInput ? tdtInput.value.trim() : '12';
    const valVang = vangInput ? vangInput.value.trim() : '125k';
    const valRuby = rubyInput ? rubyInput.value.trim() : '3400';

    // 1. Generate Card 1: Số Tướng & Trang Phục (Ô 3)
    const card1DataUrl = generateTuongSkinCard(heroCount, skinCount);
    state.croppedParts['slot_tuong_skin'] = {
      slotId: 'slot_tuong_skin',
      slotName: 'Số Tướng & Trang Phục',
      dataUrl: card1DataUrl,
      width: 230,
      height: 361,
      imgSource: 'Auto-Generated'
    };

    // 2. Generate Card 2: Tài Nguyên (Ô 4)
    const card2DataUrl = generateTaiNguyenCard(valQH, valTDT, valVang, valRuby);
    state.croppedParts['slot_tai_nguyen'] = {
      slotId: 'slot_tai_nguyen',
      slotName: 'Tài Nguyên (Quân Huy, Thẻ ĐT, Vàng, Ruby)',
      dataUrl: card2DataUrl,
      width: 230,
      height: 361,
      imgSource: 'Auto-Generated'
    };

    // Place on banner grid according to profile layout:
    let slotTuongSkin = null;
    let slotTaiNguyen = null;

    if (state.profileLayout === 'big_2x2') {
      // In 2x2 mode: 2 cards stacked vertically immediately to the right of the 2x2 block
      // Top card (Row 0, Col 2): Số Tướng & Trang Phục
      slotTuongSkin = state.bannerSlots.find(s => s.row === 0 && s.col === 2);
      // Bottom card (Row 1, Col 2): Tài Nguyên (Quân Huy, Thẻ Đổi Tên, Vàng, Ruby)
      slotTaiNguyen = state.bannerSlots.find(s => s.row === 1 && s.col === 2);
    } else {
      // In standard mode:
      slotTuongSkin = state.bannerSlots.find(s => s.row === 0 && s.col === 1) || state.bannerSlots.find(s => s.row === 1 && s.col === 0);
      slotTaiNguyen = state.bannerSlots.find(s => s.row === 1 && s.col === 1) || state.bannerSlots.find(s => s.row === 0 && s.col === 14);
    }

    if (slotTuongSkin) {
      slotTuongSkin.type = 'crop';
      slotTuongSkin.slotId = 'slot_tuong_skin';
      slotTuongSkin.slotName = 'Số Tướng & Trang Phục (Cạnh 2x2 - Trên)';
      slotTuongSkin.dataUrl = card1DataUrl;
      slotTuongSkin.colspan = 1;
      slotTuongSkin.rowspan = 1;
    }

    if (slotTaiNguyen) {
      slotTaiNguyen.type = 'crop';
      slotTaiNguyen.slotId = 'slot_tai_nguyen';
      slotTaiNguyen.slotName = 'Tài Nguyên (Cạnh 2x2 - Dưới)';
      slotTaiNguyen.dataUrl = card2DataUrl;
      slotTaiNguyen.colspan = 1;
      slotTaiNguyen.rowspan = 1;
    }

    updateCroppedGalleryUI();
    renderBannerGrid();

    const statusBadge = document.getElementById('auto-stats-status');
    if (statusBadge) {
      statusBadge.style.display = 'inline-block';
      setTimeout(() => {
        statusBadge.style.display = 'none';
      }, 3000);
    }
  }

  // Real-time live update listeners for all 6 inputs
  ['auto-hero-count', 'auto-skin-count', 'auto-quan-huy', 'auto-the-doi-ten', 'auto-vang', 'auto-ruby'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => applyAutoCards());
      el.addEventListener('change', () => applyAutoCards());
    }
  });

  const btnSyncSkin = document.getElementById('btn-sync-skin-count');
  if (btnSyncSkin) {
    btnSyncSkin.addEventListener('click', () => {
      const skinInput = document.getElementById('auto-skin-count');
      if (skinInput) {
        skinInput.value = state.selectedSkins.size;
      }
      applyAutoCards();
    });
  }

  const btnApplyAutoStats = document.getElementById('btn-apply-auto-stats');
  if (btnApplyAutoStats) {
    btnApplyAutoStats.addEventListener('click', () => {
      applyAutoCards();
    });
  }

  // =========================================================================
  // 3. TAB 2: BẢNG MA TRẬN CHỌN SKIN (TƯỚNG x BẬC)
  // =========================================================================
  const matrixHeaderRow = document.getElementById('matrix-header-row');
  const matrixBody = document.getElementById('matrix-body');
  const searchHeroInput = document.getElementById('search-hero');
  const searchSkinInput = document.getElementById('search-skin');
  const chkOnlySelected = document.getElementById('chk-only-selected');
  const chkHideEmptyCols = document.getElementById('chk-hide-empty-cols');
  const tierPillBar = document.getElementById('tier-pill-bar');
  const matrixWrapper = document.getElementById('matrix-wrapper');
  const galleryWrapper = document.getElementById('gallery-wrapper');
  const btnViewMatrix = document.getElementById('btn-view-matrix');
  const btnViewGallery = document.getElementById('btn-view-gallery');

  let activeTierFilter = 'all';

  function initTierPills() {
    if (!state.catalog || !state.catalog.tiers) return;
    const { tiers, skins } = state.catalog;

    const tierCounts = {};
    skins.forEach(s => {
      tierCounts[s.tier_folder] = (tierCounts[s.tier_folder] || 0) + 1;
    });

    tierPillBar.innerHTML = `
      <div class="tier-pill active" data-tier="all">
        Tất Cả Các Bậc <span class="pill-count">${skins.length}</span>
      </div>
      ${tiers.map(t => `
        <div class="tier-pill" data-tier="${t.folder}">
          ${t.name} <span class="pill-count">${tierCounts[t.folder] || 0}</span>
        </div>
      `).join('')}
    `;

    document.querySelectorAll('.tier-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.tier-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        activeTierFilter = pill.getAttribute('data-tier');
        applyFilters();
      });
    });
  }

  function applyFilters() {
    if (!state.catalog || !state.catalog.skins) return;

    const heroQuery = (searchHeroInput ? searchHeroInput.value : '').trim().toLowerCase();
    const skinQuery = (searchSkinInput ? searchSkinInput.value : '').trim().toLowerCase();
    const onlySelected = chkOnlySelected ? chkOnlySelected.checked : false;
    const hideEmptyCols = chkHideEmptyCols ? chkHideEmptyCols.checked : true;

    // 1. Filter tier rows in Matrix Table
    const rows = matrixBody.querySelectorAll('tr[data-tier]');
    const visibleTierFolders = new Set();
    rows.forEach(r => {
      const tierFolder = r.getAttribute('data-tier');
      const matchTier = (activeTierFilter === 'all' || activeTierFilter === tierFolder);
      r.style.display = matchTier ? '' : 'none';
      if (matchTier) {
        visibleTierFolders.add(tierFolder);
      }
    });

    // 2. Filter individual skin cards in Matrix Table
    const cards = matrixBody.querySelectorAll('.skin-card-mini');
    cards.forEach(card => {
      const skinName = card.getAttribute('data-name').toLowerCase();
      const skinId = parseInt(card.getAttribute('data-id'));
      const isSelected = state.selectedSkins.has(skinId);

      let visible = true;
      if (skinQuery && !skinName.includes(skinQuery)) visible = false;
      if (onlySelected && !isSelected) visible = false;

      card.style.display = visible ? '' : 'none';
    });

    // 3. Filter hero columns in Matrix Table
    const ths = matrixHeaderRow.querySelectorAll('th[data-hero]');
    let visibleHeroesCount = 0;

    ths.forEach(th => {
      const heroName = th.getAttribute('data-hero').toLowerCase();
      const matchHero = !heroQuery || heroName.includes(heroQuery);
      const colIndex = th.getAttribute('data-col');

      let shouldShowCol = matchHero;

      if (matchHero && hideEmptyCols) {
        // Only show column if at least one visible skin card exists in the visible rows
        let hasCard = false;
        for (const tierFolder of visibleTierFolders) {
          const cell = matrixBody.querySelector(`tr[data-tier="${tierFolder}"] td[data-col="${colIndex}"]`);
          if (cell) {
            const visibleCard = cell.querySelector('.skin-card-mini:not([style*="display: none"])');
            if (visibleCard) {
              hasCard = true;
              break;
            }
          }
        }
        shouldShowCol = hasCard;
      }

      th.style.display = shouldShowCol ? '' : 'none';
      const cells = matrixBody.querySelectorAll(`td[data-col="${colIndex}"]`);
      cells.forEach(c => {
        c.style.display = shouldShowCol ? '' : 'none';
      });

      if (shouldShowCol) {
        visibleHeroesCount++;
      }
    });

    // 4. Update Gallery Grid
    renderGalleryGrid();

    // 5. Update Status Counters
    updateFilterStatusUI(visibleHeroesCount);
  }

  // Backward compatibility alias
  const filterMatrixRows = applyFilters;

  function renderGalleryGrid() {
    const galleryGrid = document.getElementById('gallery-grid');
    if (!galleryGrid || !state.catalog || !state.catalog.skins) return;

    const heroQuery = (searchHeroInput ? searchHeroInput.value : '').trim().toLowerCase();
    const skinQuery = (searchSkinInput ? searchSkinInput.value : '').trim().toLowerCase();
    const onlySelected = chkOnlySelected ? chkOnlySelected.checked : false;

    const filteredSkins = state.catalog.skins.filter(s => {
      if (activeTierFilter !== 'all' && s.tier_folder !== activeTierFilter) return false;
      if (heroQuery && !s.hero.toLowerCase().includes(heroQuery)) return false;
      if (skinQuery && !s.skin_name.toLowerCase().includes(skinQuery)) return false;
      if (onlySelected && !state.selectedSkins.has(s.id)) return false;
      return true;
    });

    if (filteredSkins.length === 0) {
      galleryGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1; padding: 40px 20px;">
          <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
          <div style="font-size: 15px; color: #fff;">Không tìm thấy trang phục nào phù hợp với bộ lọc hiện tại.</div>
          <button type="button" class="btn btn-small btn-secondary mt-3" onclick="window.resetAllFilters()">✕ Xóa bộ lọc</button>
        </div>
      `;
      return;
    }

    galleryGrid.innerHTML = filteredSkins.map(s => {
      const isSelected = state.selectedSkins.has(s.id);
      return `
        <div class="gallery-card ${isSelected ? 'selected' : ''}"
             id="gallery-card-${s.id}"
             data-id="${s.id}"
             onclick="window.toggleSkinSelect(${s.id})"
             title="${s.hero} - ${s.skin_name} (${s.tier_name})">
          <img class="gallery-card-img" src="${s.web_path}" loading="lazy" alt="${s.skin_name}">
          <div class="gallery-card-info">
            <div class="gallery-card-hero">${s.hero}</div>
            <div class="gallery-card-name">${s.skin_name}</div>
            <div class="gallery-card-badge">${s.tier_name}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function updateFilterStatusUI(visibleHeroesCount) {
    if (!state.catalog || !state.catalog.skins) return;

    const heroQuery = (searchHeroInput ? searchHeroInput.value : '').trim().toLowerCase();
    const skinQuery = (searchSkinInput ? searchSkinInput.value : '').trim().toLowerCase();
    const onlySelected = chkOnlySelected ? chkOnlySelected.checked : false;

    const filteredSkins = state.catalog.skins.filter(s => {
      if (activeTierFilter !== 'all' && s.tier_folder !== activeTierFilter) return false;
      if (heroQuery && !s.hero.toLowerCase().includes(heroQuery)) return false;
      if (skinQuery && !s.skin_name.toLowerCase().includes(skinQuery)) return false;
      if (onlySelected && !state.selectedSkins.has(s.id)) return false;
      return true;
    });

    const statVisibleSkins = document.getElementById('stat-visible-skins');
    const statVisibleHeroes = document.getElementById('stat-visible-heroes');
    const statSelectedSkins = document.getElementById('stat-selected-skins');
    const btnResetFilters = document.getElementById('btn-reset-filters');

    if (statVisibleSkins) statVisibleSkins.textContent = filteredSkins.length;
    if (statVisibleHeroes) statVisibleHeroes.textContent = visibleHeroesCount;
    if (statSelectedSkins) statSelectedSkins.textContent = state.selectedSkins.size;

    const isFiltered = (activeTierFilter !== 'all' || heroQuery || skinQuery || onlySelected);
    if (btnResetFilters) {
      btnResetFilters.style.display = isFiltered ? 'inline-block' : 'none';
    }
  }

  window.resetAllFilters = () => {
    activeTierFilter = 'all';
    document.querySelectorAll('.tier-pill').forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-tier') === 'all');
    });
    if (searchHeroInput) searchHeroInput.value = '';
    if (searchSkinInput) searchSkinInput.value = '';
    if (chkOnlySelected) chkOnlySelected.checked = false;
    applyFilters();
  };

  // View Mode Switcher
  if (btnViewMatrix && btnViewGallery && matrixWrapper && galleryWrapper) {
    btnViewMatrix.addEventListener('click', () => {
      btnViewMatrix.classList.add('active');
      btnViewGallery.classList.remove('active');
      matrixWrapper.style.display = '';
      galleryWrapper.style.display = 'none';
    });

    btnViewGallery.addEventListener('click', () => {
      btnViewGallery.classList.add('active');
      btnViewMatrix.classList.remove('active');
      matrixWrapper.style.display = 'none';
      galleryWrapper.style.display = '';
      renderGalleryGrid();
    });
  }

  // Mouse wheel horizontal scroll on hero header row
  if (matrixHeaderRow && matrixWrapper) {
    matrixHeaderRow.addEventListener('wheel', (e) => {
      if (matrixWrapper.scrollWidth > matrixWrapper.clientWidth) {
        matrixWrapper.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  }

  // Card Size Controls (50%, 65%, 80%, 100%) - Default 65%
  function setCardScale(size) {
    const validSizes = ['50', '65', '80', '100'];
    if (!validSizes.includes(String(size))) size = '65';

    document.querySelectorAll('.btn-card-size').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-size') === String(size));
    });

    if (matrixWrapper) {
      matrixWrapper.classList.remove('size-50', 'size-65', 'size-80', 'size-100');
      matrixWrapper.classList.add(`size-${size}`);
    }
    if (galleryWrapper) {
      galleryWrapper.classList.remove('size-50', 'size-65', 'size-80', 'size-100');
      galleryWrapper.classList.add(`size-${size}`);
    }

    try {
      localStorage.setItem('skinCardSize', size);
    } catch (e) {}
  }

  document.querySelectorAll('.btn-card-size').forEach(btn => {
    btn.addEventListener('click', () => {
      const size = btn.getAttribute('data-size');
      setCardScale(size);
    });
  });

  // Initialize scale (defaults to 65% as requested)
  try {
    const savedSize = localStorage.getItem('skinCardSize') || '65';
    setCardScale(savedSize);
  } catch (e) {
    setCardScale('65');
  }

  // Expand Full-Height Button
  const btnToggleExpand = document.getElementById('btn-toggle-expand');
  const skinsSectionCard = document.querySelector('#tab-skins .section-card');
  if (btnToggleExpand && skinsSectionCard) {
    btnToggleExpand.addEventListener('click', () => {
      const isExpanded = skinsSectionCard.classList.toggle('expanded-mode');
      btnToggleExpand.innerHTML = isExpanded ? '⮌ Thu Gọn' : '⛶ Mở Rộng';
      btnToggleExpand.classList.toggle('btn-primary', isExpanded);
      btnToggleExpand.classList.toggle('btn-secondary', !isExpanded);
    });
  }

  if (searchHeroInput) searchHeroInput.addEventListener('input', applyFilters);
  if (searchSkinInput) searchSkinInput.addEventListener('input', applyFilters);
  if (chkOnlySelected) chkOnlySelected.addEventListener('change', applyFilters);
  if (chkHideEmptyCols) chkHideEmptyCols.addEventListener('change', applyFilters);

  function initMatrixTable() {
    if (!state.catalog) return;
    const heroes = state.catalog.heroes || [];
    const tiers = state.catalog.tiers || [];
    const matrix = state.catalog.matrix || {};

    // Build Header Columns: Heroes
    let headerHtml = `<th class="matrix-th-corner">Bậc Trang Phục \\ Vị Tướng (${heroes.length} tướng)</th>`;
    heroes.forEach((h, colIdx) => {
      headerHtml += `
        <th class="matrix-th-hero" data-hero="${h.name}" data-col="${colIdx}">
          <div class="hero-th-content">
            <img class="hero-avatar-mini" src="${h.avatar || './lib/cropper.min.css'}" alt="${h.name}" onerror="this.style.display='none'">
            <div class="hero-name">${h.name}</div>
            <button class="hero-btn-select-all" onclick="window.toggleAllHeroSkins('${h.name}')">
              Chọn Hết (${h.skin_count})
            </button>
          </div>
        </th>
      `;
    });
    matrixHeaderRow.innerHTML = headerHtml;

    // Build Rows: Tiers
    let bodyHtml = '';
    tiers.forEach(t => {
      bodyHtml += `<tr data-tier="${t.folder}">`;
      
      // Sticky Tier Title Cell
      bodyHtml += `
        <td class="matrix-td-tier">
          <div class="tier-th-content">
            <div class="tier-name-tag">${t.name}</div>
            <button class="tier-btn-select-all" onclick="window.toggleAllTierSkins('${t.folder}')">
              Chọn Hết Bậc
            </button>
          </div>
        </td>
      `;

      // Hero Cells
      heroes.forEach((h, colIdx) => {
        const skinsInCell = matrix[t.folder]?.[h.name] || [];
        bodyHtml += `<td class="matrix-cell" data-hero="${h.name}" data-col="${colIdx}">`;
        if (skinsInCell.length > 0) {
          bodyHtml += `<div class="cell-skins-container">`;
          skinsInCell.forEach(skin => {
            const isSelected = state.selectedSkins.has(skin.id);
            bodyHtml += `
              <div class="skin-card-mini ${isSelected ? 'selected' : ''}" 
                   id="skin-card-${skin.id}"
                   data-id="${skin.id}"
                   data-name="${skin.skin_name}"
                   title="${skin.hero} - ${skin.skin_name} (${skin.tag || skin.tier_name})"
                   onclick="window.toggleSkinSelect(${skin.id})">
                <img class="skin-mini-img" src="${skin.web_path}" loading="lazy" alt="${skin.skin_name}">
                <div class="skin-mini-name">${skin.skin_name}</div>
              </div>
            `;
          });
          bodyHtml += `</div>`;
        }
        bodyHtml += `</td>`;
      });

      bodyHtml += `</tr>`;
    });

    matrixBody.innerHTML = bodyHtml;
  }

  // Toggle single skin selection
  window.toggleSkinSelect = (skinId) => {
    if (state.selectedSkins.has(skinId)) {
      state.selectedSkins.delete(skinId);
    } else {
      state.selectedSkins.add(skinId);
    }

    const card = document.getElementById(`skin-card-${skinId}`);
    if (card) {
      card.classList.toggle('selected', state.selectedSkins.has(skinId));
    }

    const gCard = document.getElementById(`gallery-card-${skinId}`);
    if (gCard) {
      gCard.classList.toggle('selected', state.selectedSkins.has(skinId));
    }

    updateSelectedCountUI();
    if (chkOnlySelected && chkOnlySelected.checked) {
      applyFilters();
    }
  };

  // Toggle all skins for a specific hero
  window.toggleAllHeroSkins = (heroName) => {
    if (!state.catalog) return;
    const tiers = state.catalog.tiers || [];
    const matrix = state.catalog.matrix || {};
    let heroSkinIds = [];
    tiers.forEach(t => {
      const skins = matrix[t.folder]?.[heroName] || [];
      skins.forEach(s => heroSkinIds.push(s.id));
    });

    const allSelected = heroSkinIds.every(id => state.selectedSkins.has(id));
    heroSkinIds.forEach(id => {
      if (allSelected) {
        state.selectedSkins.delete(id);
      } else {
        state.selectedSkins.add(id);
      }
      const card = document.getElementById(`skin-card-${id}`);
      if (card) card.classList.toggle('selected', !allSelected);
      const gCard = document.getElementById(`gallery-card-${id}`);
      if (gCard) gCard.classList.toggle('selected', !allSelected);
    });

    updateSelectedCountUI();
    if (chkOnlySelected && chkOnlySelected.checked) {
      applyFilters();
    }
  };

  // Toggle all skins for a specific tier
  window.toggleAllTierSkins = (tierFolder) => {
    if (!state.catalog) return;
    const heroes = state.catalog.heroes || [];
    const matrix = state.catalog.matrix || {};
    let tierSkinIds = [];
    heroes.forEach(h => {
      const skins = matrix[tierFolder]?.[h.name] || [];
      skins.forEach(s => tierSkinIds.push(s.id));
    });

    const allSelected = tierSkinIds.every(id => state.selectedSkins.has(id));
    tierSkinIds.forEach(id => {
      if (allSelected) {
        state.selectedSkins.delete(id);
      } else {
        state.selectedSkins.add(id);
      }
      const card = document.getElementById(`skin-card-${id}`);
      if (card) card.classList.toggle('selected', !allSelected);
      const gCard = document.getElementById(`gallery-card-${id}`);
      if (gCard) gCard.classList.toggle('selected', !allSelected);
    });

    updateSelectedCountUI();
    if (chkOnlySelected && chkOnlySelected.checked) {
      applyFilters();
    }
  };

  function updateSelectedCountUI() {
    selectedSkinsCountEl.textContent = state.selectedSkins.size;
    const syncCountNum = document.getElementById('sync-count-num');
    if (syncCountNum) {
      syncCountNum.textContent = state.selectedSkins.size;
    }
    const statSelectedSkins = document.getElementById('stat-selected-skins');
    if (statSelectedSkins) {
      statSelectedSkins.textContent = state.selectedSkins.size;
    }
  }

  // Deselect All
  document.getElementById('btn-deselect-all').addEventListener('click', () => {
    if (confirm('Bỏ chọn tất cả các skin hiện tại?')) {
      state.selectedSkins.clear();
      document.querySelectorAll('.skin-card-mini.selected').forEach(c => c.classList.remove('selected'));
      document.querySelectorAll('.gallery-card.selected').forEach(c => c.classList.remove('selected'));
      updateSelectedCountUI();
      if (chkOnlySelected && chkOnlySelected.checked) {
        applyFilters();
      }
    }
  });

  // Sample Select (Choose ~45 diverse skins to immediately test layout)
  document.getElementById('btn-sample-select').addEventListener('click', () => {
    state.selectedSkins.clear();
    const { skins } = state.catalog;

    // Pick top skins from SSS, SS, S+, Thưởng Hạng, EVO, Collab
    const samplePicks = skins.filter(s => {
      const tf = s.tier_folder;
      return tf.includes('1_Bậc SSS') || 
             tf.includes('2_Bậc SS') || 
             tf.includes('6_Bậc EVO') || 
             tf.includes('9_Thưởng Hạng') || 
             tf.includes('10_Collab') || 
             tf.includes('7_Bậc Mystic') ||
             (tf.includes('3_Bậc S+') && s.hero.startsWith('A'));
    }).slice(0, 50);

    samplePicks.forEach(s => state.selectedSkins.add(s.id));

    // Update UI cards in Matrix and Gallery
    document.querySelectorAll('.skin-card-mini').forEach(card => {
      const id = parseInt(card.getAttribute('data-id'));
      card.classList.toggle('selected', state.selectedSkins.has(id));
    });
    document.querySelectorAll('.gallery-card').forEach(card => {
      const id = parseInt(card.getAttribute('data-id'));
      card.classList.toggle('selected', state.selectedSkins.has(id));
    });

    updateSelectedCountUI();
    alert(`Đã chọn ngẫu nhiên ${state.selectedSkins.size} skin mẫu để test banner!`);
    switchTab('tab-banner');
  });

  // =========================================================================
  // 3.1. AUTO-IMPORT FROM TEXT LIST (NẠP TỰ ĐỘNG TỪ DANH SÁCH TEXT)
  // =========================================================================
  const btnImportList = document.getElementById('btn-import-list');
  const importModal = document.getElementById('import-modal');
  const btnCloseImportModal = document.getElementById('btn-close-import-modal');
  const btnCancelImport = document.getElementById('btn-cancel-import');
  const btnDoImport = document.getElementById('btn-do-import');
  const btnApplyAndArrange = document.getElementById('btn-apply-and-arrange');
  const importSkinText = document.getElementById('import-skin-text');
  const chkClearPrevious = document.getElementById('chk-clear-previous');
  const importTotalLines = document.getElementById('import-total-lines');
  const importResultPanel = document.getElementById('import-result-panel');
  const importSuccessCount = document.getElementById('import-success-count');
  const importFailCount = document.getElementById('import-fail-count');
  const importFailBadge = document.getElementById('import-fail-badge');
  const importMatchedList = document.getElementById('import-matched-list');
  const importUnmatchedBox = document.getElementById('import-unmatched-box');
  const importUnmatchedList = document.getElementById('import-unmatched-list');
  const btnPasteClipboard = document.getElementById('btn-paste-clipboard');
  const btnSampleImport = document.getElementById('btn-sample-import');
  const btnClearImport = document.getElementById('btn-clear-import');

  function removeVietnameseAccents(str) {
    if (!str) return '';
    return str.normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd');
  }

  function cleanSearchText(str) {
    if (!str) return '';
    let s = removeVietnameseAccents(str).toLowerCase();
    // Normalize Roman / Arabic numbers
    s = s.replace(/\b(bac|cap|lv|level)\s*1\b/g, 'bac i');
    s = s.replace(/\b(bac|cap|lv|level)\s*2\b/g, 'bac ii');
    s = s.replace(/\b(bac|cap|lv|level)\s*3\b/g, 'bac iii');
    s = s.replace(/\b(bac|cap|lv|level)\s*4\b/g, 'bac iv');
    s = s.replace(/\b(bac|cap|lv|level)\s*5\b/g, 'bac v');
    s = s.replace(/\b(i|ii|iii|iv|v)\b/g, 'bac $1');
    s = s.replace(/[^a-z0-9\s]/g, ' ');
    return s.split(/\s+/).filter(Boolean).join(' ');
  }

  function matchSingleLine(line, allSkins, allHeroes) {
    const raw = (line || '').trim();
    if (!raw) return null;

    // 1. Strip leading line numbering like "1.", "1 -", "1)", "-", "*", bullet
    let q = raw.replace(/^\s*\d+[\.\-\)]\s*/, '').replace(/^\s*[\-\*\•]\s*/, '').trim();
    let cleanLine = cleanSearchText(q);
    if (cleanLine.length < 2) return null;

    // 2. Check if a hero name is explicitly mentioned in the line
    let detectedHero = null;
    let remainingQ = cleanLine;

    // Sort heroes by length desc so "Ngộ Không" matches before "Ngộ"
    const sortedHeroes = [...allHeroes].sort((a, b) => b.name.length - a.name.length);

    // Ưu tiên 1: Tên tướng nằm ngay đầu dòng (ví dụ "Alice The Butterfly Mansion Girl" -> tướng là Alice)
    for (const h of sortedHeroes) {
      const ch = cleanSearchText(h.name);
      if (ch && (cleanLine === ch || cleanLine.startsWith(ch + ' '))) {
        detectedHero = h.name;
        remainingQ = cleanSearchText(cleanLine.substring(ch.length));
        break;
      }
    }

    // Ưu tiên 2: Tên tướng nằm ở vị trí bất kỳ
    if (!detectedHero) {
      for (const h of sortedHeroes) {
        const ch = cleanSearchText(h.name);
        if (ch && cleanLine.includes(ch)) {
          detectedHero = h.name;
          remainingQ = cleanSearchText(cleanLine.replace(ch, ' '));
          break;
        }
      }
    }

    let candidates = allSkins;
    if (detectedHero) {
      candidates = allSkins.filter(s => s.hero === detectedHero);
      if (remainingQ.length < 2) {
        return candidates[0] || null;
      }
    }

    const targetQ = (detectedHero && remainingQ.length >= 2) ? remainingQ : cleanLine;
    const targetWords = new Set(targetQ.split(' '));

    const scored = [];
    for (const s of candidates) {
      const cs = cleanSearchText(s.skin_name);
      if (cs.length < 2) continue;

      let score = 0;
      if (targetQ === cs) {
        score = 100;
      } else if (cs.startsWith(targetQ) || targetQ.startsWith(cs)) {
        score = 90;
      } else if (cs.includes(targetQ)) {
        score = 80;
      } else if (targetQ.includes(cs)) {
        score = 75;
      } else {
        const sWords = new Set(cs.split(' '));
        let commonCount = 0;
        targetWords.forEach(w => {
          if (sWords.has(w)) commonCount++;
        });

        if (commonCount >= 2) {
          score = 50 + commonCount * 10;
        } else if (commonCount === 1 && targetWords.size === 1 && Array.from(targetWords)[0].length >= 4) {
          score = 45;
        }
      }

      if (score > 0) {
        scored.push({ score, skin: s });
      }
    }

    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    return scored[0].skin;
  }

  function updateImportLineCount() {
    if (!importSkinText || !importTotalLines) return;
    const lines = importSkinText.value.split('\n').filter(l => l.trim().length > 0);
    importTotalLines.textContent = lines.length;
  }

  if (importSkinText) {
    importSkinText.addEventListener('input', updateImportLineCount);
    importSkinText.addEventListener('change', updateImportLineCount);
  }

  // Open Modal
  if (btnImportList && importModal) {
    btnImportList.addEventListener('click', () => {
      importModal.classList.add('active');
      if (importSkinText) {
        importSkinText.focus();
        updateImportLineCount();
      }
    });
  }

  // Close Modal
  function closeImportModal() {
    if (importModal) importModal.classList.remove('active');
  }

  if (btnCloseImportModal) btnCloseImportModal.addEventListener('click', closeImportModal);
  if (btnCancelImport) btnCancelImport.addEventListener('click', closeImportModal);

  // Paste from clipboard button
  if (btnPasteClipboard && importSkinText) {
    btnPasteClipboard.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          importSkinText.value = text;
          updateImportLineCount();
        } else {
          alert('Bộ nhớ tạm (Clipboard) đang trống!');
        }
      } catch (err) {
        alert('Trình duyệt yêu cầu quyền truy cập Clipboard. Bạn có thể nhấn Ctrl + V để dán trực tiếp vào ô!');
      }
    });
  }

  // Sample import button
  if (btnSampleImport && importSkinText) {
    btnSampleImport.addEventListener('click', () => {
      importSkinText.value = [
        "1. Thứ nguyên vệ thần",
        "2. Siêu việt bậc V",
        "3. Chiến thần bậc V",
        "4. Nhóc tì bá đạo bậc V",
        "5. Bích hải thánh nữ",
        "6. Vũ khí tối thượng",
        "7. Hắc kiếm sĩ Kirito",
        "8. Tân niên Võ Thần",
        "9. Ma pháp đại sư",
        "10. Quỷ kiếm Dạ xoa",
        "11. Tuyết sơn Song kiếm",
        "12. Huyết sắc Lạc hồng",
        "13. Phi tiêu bóng đêm",
        "14. Bá vương cơ giáp",
        "15. Vô địch chiến thần"
      ].join('\n');
      updateImportLineCount();
    });
  }

  // Clear import textarea
  if (btnClearImport && importSkinText) {
    btnClearImport.addEventListener('click', () => {
      importSkinText.value = '';
      updateImportLineCount();
      if (importResultPanel) importResultPanel.style.display = 'none';
      if (btnApplyAndArrange) btnApplyAndArrange.style.display = 'none';
    });
  }

  // Execute Import
  if (btnDoImport) {
    btnDoImport.addEventListener('click', () => {
      if (!state.catalog || !state.catalog.skins) {
        alert('Dữ liệu skin chưa tải xong, vui lòng đợi giây lát!');
        return;
      }

      const text = (importSkinText ? importSkinText.value : '').trim();
      if (!text) {
        alert('Vui lòng nhập hoặc dán ít nhất 1 dòng tên skin!');
        return;
      }

      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length === 0) {
        alert('Vui lòng nhập danh sách skin hợp lệ!');
        return;
      }

      // Clear previous selection if requested
      if (chkClearPrevious && chkClearPrevious.checked) {
        state.selectedSkins.clear();
      }

      const matchedResults = [];
      const unmatchedLines = [];

      lines.forEach(line => {
        const match = matchSingleLine(line, state.catalog.skins, state.catalog.heroes);
        if (match) {
          state.selectedSkins.add(match.id);
          matchedResults.push({ line, skin: match });
        } else {
          unmatchedLines.push(line);
        }
      });

      // Update UI selection for matrix and gallery cards
      document.querySelectorAll('.skin-card-mini').forEach(card => {
        const id = parseInt(card.getAttribute('data-id'));
        card.classList.toggle('selected', state.selectedSkins.has(id));
      });
      document.querySelectorAll('.gallery-card').forEach(card => {
        const id = parseInt(card.getAttribute('data-id'));
        card.classList.toggle('selected', state.selectedSkins.has(id));
      });

      updateSelectedCountUI();
      if (chkOnlySelected && chkOnlySelected.checked) {
        applyFilters();
      }

      // Display results panel
      if (importResultPanel) {
        importResultPanel.style.display = 'block';
        if (importSuccessCount) importSuccessCount.textContent = matchedResults.length;

        if (unmatchedLines.length > 0) {
          if (importFailBadge) {
            importFailBadge.style.display = 'inline-block';
            if (importFailCount) importFailCount.textContent = unmatchedLines.length;
          }
          if (importUnmatchedBox) importUnmatchedBox.style.display = 'block';
          if (importUnmatchedList) {
            importUnmatchedList.innerHTML = unmatchedLines.map(l => `<div>• ${l}</div>`).join('');
          }
        } else {
          if (importFailBadge) importFailBadge.style.display = 'none';
          if (importUnmatchedBox) importUnmatchedBox.style.display = 'none';
        }

        if (importMatchedList) {
          importMatchedList.innerHTML = matchedResults.map(({ skin }) => `
            <div class="import-matched-item" title="${skin.hero} - ${skin.skin_name} (${skin.tier_name})">
              <img class="import-item-img" src="${skin.web_path}" loading="lazy" alt="${skin.skin_name}">
              <div class="import-item-info">
                <div class="import-item-hero">${skin.hero}</div>
                <div class="import-item-skin">${skin.skin_name}</div>
                <div class="import-item-tier">${skin.tier_name}</div>
              </div>
            </div>
          `).join('');
        }

        if (btnApplyAndArrange) {
          btnApplyAndArrange.style.display = 'inline-flex';
        }
      }
    });
  }

  // Apply and arrange to banner button
  if (btnApplyAndArrange) {
    btnApplyAndArrange.addEventListener('click', () => {
      closeImportModal();
      arrangeSkinsToBanner();
      switchTab('tab-banner');
    });
  }

  // Auto Fill into Banner
  const btnAutoFill = document.getElementById('btn-auto-fill-banner');
  if (btnAutoFill) {
    btnAutoFill.addEventListener('click', () => {
      if (state.selectedSkins.size === 0) {
        alert('Vui lòng tick chọn một số skin trước!');
        return;
      }
      arrangeSkinsToBanner();
      switchTab('tab-banner');
    });
  }

  // =========================================================================
  // 4. TAB 3: XEM TRƯỚC BANNER & TINH CHỈNH BỐ CỤC
  // =========================================================================
  const bannerWrapper = document.getElementById('banner-wrapper');
  const bannerRowsSelect = document.getElementById('banner-rows-count');
  const profileLayoutSelect = document.getElementById('profile-layout-style');

  // Calculate highest row index with actual content (crop or skin)
  function getActiveRowsCount() {
    let maxRow = 1; // Always at least row 0 and 1 for profile
    state.bannerSlots.forEach(slot => {
      const hasContent = (slot.type === 'crop' && slot.dataUrl) || (slot.type === 'skin' && slot.skin);
      if (hasContent) {
        const endRow = slot.row + (slot.rowspan || 1) - 1;
        if (endRow > maxRow) {
          maxRow = endRow;
        }
      }
    });
    return maxRow + 1;
  }

  // Calculate needed rows based on number of selected skins (or displayed skins)
  function computeNeededRows(customCount) {
    if (state.bannerRowsMode !== 'auto') {
      return state.bannerRowsFixed || 6;
    }
    const n = customCount !== undefined ? customCount : state.selectedSkins.size;
    let baseSlots = 24; // in big_2x2 (12 in row 0 + 12 in row 1)
    if (state.profileLayout === 'wide_2x1' || state.profileLayout === 'standard') {
      baseSlots = 26;
    }
    if (n <= baseSlots) {
      return 2;
    }
    return 2 + Math.ceil((n - baseSlots) / 15);
  }

  bannerRowsSelect.addEventListener('change', () => {
    if (bannerRowsSelect.value === 'auto') {
      state.bannerRowsMode = 'auto';
      state.bannerRows = computeNeededRows();
    } else {
      state.bannerRowsMode = 'fixed';
      state.bannerRowsFixed = parseInt(bannerRowsSelect.value);
      state.bannerRows = state.bannerRowsFixed;
    }
    buildInitialBannerSlots(true);
    arrangeSkinsToBanner();
    renderBannerGrid();
  });

  if (profileLayoutSelect) {
    profileLayoutSelect.addEventListener('change', () => {
      state.profileLayout = profileLayoutSelect.value;
      if (state.bannerRowsMode === 'auto') {
        state.bannerRows = computeNeededRows();
      }
      buildInitialBannerSlots(true);
      applyAutoCards();
      arrangeSkinsToBanner();
      renderBannerGrid();
    });
  }

  // Zoom preview buttons
  document.querySelectorAll('.btn-zoom').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-zoom').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.zoomCardW = parseInt(btn.getAttribute('data-zoom')) || 160;
      renderBannerGrid();
    });
  });

  const sortModeSelect = document.getElementById('sort-mode-style');
  if (sortModeSelect) {
    sortModeSelect.addEventListener('change', () => {
      state.sortMode = sortModeSelect.value;
      arrangeSkinsToBanner();
      renderBannerGrid();
    });
  }

  document.getElementById('btn-sort-hierarchy').addEventListener('click', () => {
    arrangeSkinsToBanner();
    renderBannerGrid();
  });

  // Exclude Tier Filter Toggles with Smart Auto-Fill Last Row
  const excludeCheckboxes = [
    { id: 'chk-exclude-a', key: 'a' },
    { id: 'chk-exclude-rank', key: 'rank' },
    { id: 'chk-exclude-s', key: 's' },
    { id: 'chk-exclude-ssm', key: 'ssm' },
    { id: 'chk-exclude-splus', key: 'splus' }
  ];

  excludeCheckboxes.forEach(({ id, key }) => {
    const chk = document.getElementById(id);
    if (chk) {
      chk.addEventListener('change', () => {
        state.excludeTiers[key] = chk.checked;
        const chip = chk.closest('.exclude-chip');
        if (chip) chip.classList.toggle('active', chk.checked);
        arrangeSkinsToBanner();
      });
    }
  });

  function buildInitialBannerSlots(preserveCrops = true) {
    if (state.bannerRowsMode === 'auto') {
      state.bannerRows = computeNeededRows();
      if (bannerRowsSelect && bannerRowsSelect.value !== 'auto') {
        bannerRowsSelect.value = 'auto';
      }
    }
    const rows = state.bannerRows;
    const cols = state.bannerCols;
    const oldCrops = preserveCrops ? { ...state.croppedParts } : {};

    state.bannerSlots = [];

    if (state.profileLayout === 'big_2x2') {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (r < 2 && c < 2) {
            if (r === 0 && c === 0) {
              state.bannerSlots.push({
                index: state.bannerSlots.length,
                row: 0,
                col: 0,
                colspan: 2,
                rowspan: 2,
                type: 'empty',
                skin: null,
                dataUrl: null,
                slotName: null,
                slotId: null
              });
            }
            continue; // Skip (0,1), (1,0), (1,1)
          }

          state.bannerSlots.push({
            index: state.bannerSlots.length,
            row: r,
            col: c,
            colspan: 1,
            rowspan: 1,
            type: 'empty',
            skin: null,
            dataUrl: null,
            slotName: null,
            slotId: null
          });
        }
      }
    } else if (state.profileLayout === 'wide_2x1') {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (r === 0 && c === 1) continue;
          if (r === 1 && c === 1) continue;
          const isDouble = (c === 0 && (r === 0 || r === 1));
          state.bannerSlots.push({
            index: state.bannerSlots.length,
            row: r,
            col: c,
            colspan: isDouble ? 2 : 1,
            rowspan: 1,
            type: 'empty',
            skin: null,
            dataUrl: null,
            slotName: null,
            slotId: null
          });
        }
      }
    } else {
      // standard layout: all slots are individual 1x1 cards
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          state.bannerSlots.push({
            index: state.bannerSlots.length,
            row: r,
            col: c,
            colspan: 1,
            rowspan: 1,
            type: 'empty',
            skin: null,
            dataUrl: null,
            slotName: null,
            slotId: null
          });
        }
      }
    }

    // Reapply existing cropped parts
    Object.keys(oldCrops).forEach(k => {
      const part = oldCrops[k];
      applyCropToBannerSlot(k, part.dataUrl, part.slotName);
    });
  }

  const TIER_WEIGHTS = {
    '1_Bậc SSS & SSS+': 1,
    '2_Bậc SS & SS+': 2,
    '10_Collab Anime': 2.5,
    '7_Bậc Mystic': 2.6,
    '11_Sự Kiện Đặc Biệt': 2.7,
    '3_Bậc S+': 3,
    '6_Bậc EVO': 4,
    '8_Sổ Sứ Mệnh': 5,
    '4_Bậc S': 6,
    '12_Hữu Hạn': 6.5,
    '9_Thưởng Hạng': 7,
    '12_A': 8,
    '5_Bậc A': 8,
    '13_Bậc Thường': 9
  };

  // Get priority within tier folder (ưu tiên 1 -> 2 -> 3 -> root -> _backup_original)
  function getFolderPriority(skin) {
    if (skin && skin.priority != null) return skin.priority;
    const sub = (skin && skin.subfolder) || '';
    if (!sub) return 999;
    if (sub === '_backup_original') return 9999;
    const m = sub.match(/ưu\s*tiên\s*(\d+)/i) || sub.match(/uu\s*tien\s*(\d+)/i);
    if (m) return parseInt(m[1], 10);
    if (/ưu\s*tiên/i.test(sub) || /uu\s*tien/i.test(sub)) return 0.5;
    return 900;
  }

  function isSkinTierExcluded(skin) {
    if (!skin) return false;
    const tf = skin.tier_folder || '';
    if (state.excludeTiers.a && (tf.startsWith('12_A') || tf.startsWith('5_Bậc A') || tf.startsWith('13_Bậc Thường'))) return true;
    if (state.excludeTiers.rank && tf.startsWith('9_Thưởng Hạng')) return true;
    if (state.excludeTiers.s && (tf.startsWith('4_Bậc S') || tf.startsWith('12_Hữu Hạn'))) return true;
    if (state.excludeTiers.ssm && tf.startsWith('8_Sổ Sứ Mệnh')) return true;
    if (state.excludeTiers.splus && tf.startsWith('3_Bậc S+')) return true;
    return false;
  }

  function isReservedProfileSlot(slot) {
    if (state.profileLayout === 'big_2x2') {
      return (slot.row === 0 && slot.col === 0) ||
             (slot.row === 0 && slot.col === 2) ||
             (slot.row === 1 && slot.col === 2);
    }
    if (state.profileLayout === 'standard') {
      return (slot.row === 0 && slot.col === 0) ||
             (slot.row === 0 && slot.col === 1) ||
             (slot.row === 1 && slot.col === 1);
    }
    if (state.profileLayout === 'wide_2x1') {
      return (slot.row === 0 && slot.col === 0) ||
             (slot.row === 1 && slot.col === 0) ||
             (slot.row === 0 && slot.col === 2) ||
             (slot.row === 1 && slot.col === 2);
    }
    return false;
  }

  function getRowSkinCapacity(r) {
    if (r >= 2) return state.bannerCols || 15;
    if (state.profileLayout === 'standard') {
      return r === 0 ? 13 : 14;
    }
    return 12; // big_2x2 and wide_2x1 have 12 skin slots in rows 0 and 1
  }

  function getCumulativeSkinCapacity(R) {
    let total = 0;
    for (let r = 0; r <= R; r++) {
      total += getRowSkinCapacity(r);
    }
    return total;
  }

  // Detect anime collab / theme collection
  function detectSkinTheme(skin) {
    if (skin.theme) return skin.theme;
    const fn = (skin.filename || '').toLowerCase();
    const tag = (skin.tag || '').toLowerCase();
    const sname = (skin.skin_name || '').toLowerCase();
    const text = `${fn} ${tag} ${sname}`;

    if (text.includes('thứ nguyên') || text.includes('thứ nguyên vệ thần')) return 'Thứ Nguyên Vệ Thần';
    if (text.includes('attack on titan') || text.includes('eren') || text.includes('mikasa') || text.includes('annie') || text.includes('scout regiment')) return 'Attack on Titan';
    if (text.includes('sailor moon') || text.includes('tuxedo') || text.includes('chibi moon')) return 'Sailor Moon';
    if (text.includes('jujutsu') || text.includes('gojo') || text.includes('fushiguro') || text.includes('itadori')) return 'Jujutsu Kaisen';
    if (text.includes('hunter') || text.includes('killua') || text.includes('gon') || text.includes('kurapika') || text.includes('hisoka')) return 'Hunter x Hunter';
    if (text.includes('sword art') || text.includes('kirito') || text.includes('asuna')) return 'Sword Art Online';
    if (text.includes('bleach') || text.includes('ichigo') || text.includes('hitsugaya') || text.includes('byakuya') || text.includes('rukia')) return 'Bleach';
    if (text.includes('one-punch') || text.includes('saitama') || text.includes('tatsumaki') || text.includes('genos')) return 'One-Punch Man';
    if (text.includes('tanjiro') || text.includes('nezuko') || text.includes('zenitsu') || text.includes('inosuke')) return 'Demon Slayer';
    if (text.includes('conan') || text.includes('siêu đạo chích kid')) return 'Conan';
    if (text.includes('sanrio') || text.includes('kuromi') || text.includes('cinnamoroll') || text.includes('melody')) return 'Sanrio';
    if (text.includes('tiệc bãi biển')) return 'Tiệc Bãi Biển';
    if (text.includes('thần sứ')) return 'Thần Sứ';
    if (text.includes('siêu việt')) return 'Siêu Việt';
    if (text.includes('thưởng hạng')) return 'Thưởng Hạng';
    return null;
  }

  // Smart skin clustering & sorting algorithm
  function clusterAndSortSkins(skinList, mode = 'smart') {
    if (!skinList || skinList.length === 0) return [];

    // Mode 1: Pure tier sort (Bậc cao -> thấp, subfolder ưu tiên 1 -> 2 -> 3 -> root)
    if (mode === 'tier') {
      return [...skinList].sort((a, b) => {
        const wa = TIER_WEIGHTS[a.tier_folder] || 99;
        const wb = TIER_WEIGHTS[b.tier_folder] || 99;
        if (wa !== wb) return wa - wb;
        const pa = getFolderPriority(a);
        const pb = getFolderPriority(b);
        if (pa !== pb) return pa - pb;
        return a.hero.localeCompare(b.hero) || a.skin_name.localeCompare(b.skin_name);
      });
    }

    // Mode 2: Pure hero sort (all skins of each hero strictly grouped together)
    if (mode === 'hero') {
      const heroGroups = {};
      skinList.forEach(s => {
        heroGroups[s.hero] = heroGroups[s.hero] || [];
        heroGroups[s.hero].push(s);
      });
      Object.keys(heroGroups).forEach(h => {
        heroGroups[h].sort((a, b) => {
          const wa = TIER_WEIGHTS[a.tier_folder] || 99;
          const wb = TIER_WEIGHTS[b.tier_folder] || 99;
          if (wa !== wb) return wa - wb;
          const pa = getFolderPriority(a);
          const pb = getFolderPriority(b);
          if (pa !== pb) return pa - pb;
          return a.skin_name.localeCompare(b.skin_name);
        });
      });
      const sortedHeroes = Object.keys(heroGroups).sort((h1, h2) => {
        const minW1 = Math.min(...heroGroups[h1].map(s => TIER_WEIGHTS[s.tier_folder] || 99));
        const minW2 = Math.min(...heroGroups[h2].map(s => TIER_WEIGHTS[s.tier_folder] || 99));
        if (minW1 !== minW2) return minW1 - minW2;
        const minP1 = Math.min(...heroGroups[h1].map(s => getFolderPriority(s)));
        const minP2 = Math.min(...heroGroups[h2].map(s => getFolderPriority(s)));
        if (minP1 !== minP2) return minP1 - minP2;
        if (heroGroups[h2].length !== heroGroups[h1].length) return heroGroups[h2].length - heroGroups[h1].length;
        return h1.localeCompare(h2);
      });
      const res = [];
      sortedHeroes.forEach(h => res.push(...heroGroups[h]));
      return res;
    }

    // Mode 3: Pure theme / collection sort
    if (mode === 'theme') {
      const themeGroups = {};
      skinList.forEach(s => {
        const t = detectSkinTheme(s) || ('Hero_' + s.hero);
        themeGroups[t] = themeGroups[t] || [];
        themeGroups[t].push(s);
      });
      Object.keys(themeGroups).forEach(t => {
        themeGroups[t].sort((a, b) => {
          const wa = TIER_WEIGHTS[a.tier_folder] || 99;
          const wb = TIER_WEIGHTS[b.tier_folder] || 99;
          if (wa !== wb) return wa - wb;
          const pa = getFolderPriority(a);
          const pb = getFolderPriority(b);
          if (pa !== pb) return pa - pb;
          return a.skin_name.localeCompare(b.skin_name);
        });
      });
      const sortedThemes = Object.keys(themeGroups).sort((t1, t2) => {
        const minW1 = Math.min(...themeGroups[t1].map(s => TIER_WEIGHTS[s.tier_folder] || 99));
        const minW2 = Math.min(...themeGroups[t2].map(s => TIER_WEIGHTS[s.tier_folder] || 99));
        if (minW1 !== minW2) return minW1 - minW2;
        const minP1 = Math.min(...themeGroups[t1].map(s => getFolderPriority(s)));
        const minP2 = Math.min(...themeGroups[t2].map(s => getFolderPriority(s)));
        if (minP1 !== minP2) return minP1 - minP2;
        return t1.localeCompare(t2);
      });
      const res = [];
      sortedThemes.forEach(t => res.push(...themeGroups[t]));
      return res;
    }

    // Mode 4: SMART GROUPING (DEFAULT)
    // 1. SSS Subfolders (ưu tiên 1 -> 2 -> 3) - Highest priority, placed right at top
    // 2. Dedicated Hero Subfolder - Other skins of the same hero join right next to them
    // 3. Multi-skin Heroes (Nakroth, Airi, Tulen, Murad...) - Placed together
    // 4. Multi-skin Collab/Anime Themes - Placed together
    // 5. Standalone skins by tier
    const heroCounts = {};
    const themeCounts = {};
    const sssSubHeroes = {};

    skinList.forEach(s => {
      heroCounts[s.hero] = (heroCounts[s.hero] || 0) + 1;
      const t = detectSkinTheme(s);
      if (t) themeCounts[t] = (themeCounts[t] || 0) + 1;
      if ((s.tier_folder || '').startsWith('1_') && s.subfolder) {
        sssSubHeroes[s.subfolder] = sssSubHeroes[s.subfolder] || new Set();
        sssSubHeroes[s.subfolder].add(s.hero);
      }
    });

    const clusters = {};
    skinList.forEach(s => {
      const sub = s.subfolder || '';
      const tf = s.tier_folder || '';
      const h = s.hero;
      const t = detectSkinTheme(s);

      let key = '';
      if (tf.startsWith('1_') && sub) {
        // Explicit SSS Subfolder created by user
        key = `1_SUB::${sub}`;
      } else if (Object.keys(sssSubHeroes).some(k => sssSubHeroes[k].size === 1 && sssSubHeroes[k].has(h))) {
        // Dedicated hero subfolder exists (e.g. Nakroth in New folder 3) -> Join cluster!
        const matchSub = Object.keys(sssSubHeroes).find(k => sssSubHeroes[k].size === 1 && sssSubHeroes[k].has(h));
        key = `1_SUB::${matchSub}`;
      } else if (heroCounts[h] >= 2) {
        // Group all skins of the same hero together
        key = `2_HERO::${h}`;
      } else if (t && themeCounts[t] >= 2) {
        // Group related collab/theme together
        key = `3_THEME::${t}`;
      } else {
        const w = TIER_WEIGHTS[tf] || 99;
        const p = getFolderPriority(s);
        key = `4_STANDALONE::${w.toFixed(1)}::${p}::${h}::${s.id}`;
      }

      clusters[key] = clusters[key] || [];
      clusters[key].push(s);
    });

    // Sort skins inside each cluster
    Object.keys(clusters).forEach(key => {
      const items = clusters[key];
      if (key.startsWith('1_SUB')) {
        // In SSS subfolder: subfolder skins first, then additional hero skins, sorted by tier and folder priority
        items.sort((a, b) => {
          const aInSub = a.tier_folder.startsWith('1_') && a.subfolder ? 0 : 1;
          const bInSub = b.tier_folder.startsWith('1_') && b.subfolder ? 0 : 1;
          if (aInSub !== bInSub) return aInSub - bInSub;
          const wa = TIER_WEIGHTS[a.tier_folder] || 99;
          const wb = TIER_WEIGHTS[b.tier_folder] || 99;
          if (wa !== wb) return wa - wb;
          const pa = getFolderPriority(a);
          const pb = getFolderPriority(b);
          if (pa !== pb) return pa - pb;
          return a.skin_name.localeCompare(b.skin_name);
        });
      } else if (key.startsWith('2_HERO')) {
        // Inside hero cluster: sort by tier weight & priority (VIP first: SSS -> SS -> S+ -> EVO -> SSM -> S -> Thưởng Hạng -> A)
        items.sort((a, b) => {
          const wa = TIER_WEIGHTS[a.tier_folder] || 99;
          const wb = TIER_WEIGHTS[b.tier_folder] || 99;
          if (wa !== wb) return wa - wb;
          const pa = getFolderPriority(a);
          const pb = getFolderPriority(b);
          if (pa !== pb) return pa - pb;
          return a.skin_name.localeCompare(b.skin_name);
        });
      } else if (key.startsWith('3_THEME')) {
        items.sort((a, b) => {
          const wa = TIER_WEIGHTS[a.tier_folder] || 99;
          const wb = TIER_WEIGHTS[b.tier_folder] || 99;
          if (wa !== wb) return wa - wb;
          const pa = getFolderPriority(a);
          const pb = getFolderPriority(b);
          if (pa !== pb) return pa - pb;
          return a.hero.localeCompare(b.hero);
        });
      }
    });

    // Sort clusters relative to each other
    const sortedKeys = Object.keys(clusters).sort((k1, k2) => {
      const items1 = clusters[k1];
      const items2 = clusters[k2];
      const minW1 = Math.min(...items1.map(s => TIER_WEIGHTS[s.tier_folder] || 99));
      const minW2 = Math.min(...items2.map(s => TIER_WEIGHTS[s.tier_folder] || 99));

      // 1. SSS Subfolders are highest priority (top of banner)
      const isSub1 = k1.startsWith('1_SUB');
      const isSub2 = k2.startsWith('1_SUB');
      if (isSub1 && !isSub2) return -1;
      if (!isSub1 && isSub2) return 1;
      if (isSub1 && isSub2) {
        const p1 = Math.min(...items1.map(s => getFolderPriority(s)));
        const p2 = Math.min(...items2.map(s => getFolderPriority(s)));
        if (p1 !== p2) return p1 - p2;
        return k1.localeCompare(k2);
      }

      // 2. Minimum tier weight (heroes with SSS first, then SS, then S+, etc.)
      if (minW1 !== minW2) return minW1 - minW2;

      // 2.1 Minimum folder priority (ưu tiên 1 -> 2 -> 3 -> root)
      const minP1 = Math.min(...items1.map(s => getFolderPriority(s)));
      const minP2 = Math.min(...items2.map(s => getFolderPriority(s)));
      if (minP1 !== minP2) return minP1 - minP2;

      // 3. If tier tied, prioritize Hero clusters with more skins
      const isHero1 = k1.startsWith('2_HERO');
      const isHero2 = k2.startsWith('2_HERO');
      if (isHero1 && !isHero2) return -1;
      if (!isHero1 && isHero2) return 1;
      if (isHero1 && isHero2) {
        if (items2.length !== items1.length) return items2.length - items1.length;
        return k1.localeCompare(k2);
      }

      // 4. Then Themes
      const isTheme1 = k1.startsWith('3_THEME');
      const isTheme2 = k2.startsWith('3_THEME');
      if (isTheme1 && !isTheme2) return -1;
      if (!isTheme1 && isTheme2) return 1;

      return k1.localeCompare(k2);
    });

    const finalResult = [];
    sortedKeys.forEach(k => {
      finalResult.push(...clusters[k]);
    });
    return finalResult;
  }

  function arrangeSkinsToBanner() {
    const { skins } = state.catalog;
    // Get all selected skin objects
    const selectedList = skins.filter(s => state.selectedSkins.has(s.id));

    const isAnyExcludeActive = Object.values(state.excludeTiers).some(Boolean);

    let finalSkinsToPlace = [];

    if (!isAnyExcludeActive) {
      finalSkinsToPlace = clusterAndSortSkins(selectedList, state.sortMode || 'smart');
    } else {
      const keptList = [];
      const excludedList = [];
      selectedList.forEach(s => {
        if (isSkinTierExcluded(s)) {
          excludedList.push(s);
        } else {
          keptList.push(s);
        }
      });

      const sortedKeptList = clusterAndSortSkins(keptList, state.sortMode || 'smart');

      // Sort excluded skins strictly by tier hierarchy & folder priority
      // (S+ -> EVO -> Sổ Sứ Mệnh -> S -> Thưởng Hạng -> A)
      excludedList.sort((a, b) => {
        const wa = TIER_WEIGHTS[a.tier_folder] || 99;
        const wb = TIER_WEIGHTS[b.tier_folder] || 99;
        if (wa !== wb) return wa - wb;
        const pa = getFolderPriority(a);
        const pb = getFolderPriority(b);
        if (pa !== pb) return pa - pb;
        return a.hero.localeCompare(b.hero) || a.skin_name.localeCompare(b.skin_name);
      });

      const K = sortedKeptList.length;
      let targetRow = 1; // at least 2 rows (row 0 and row 1)
      if (state.bannerRowsMode === 'fixed') {
        targetRow = Math.max(1, state.bannerRowsFixed - 1);
      } else {
        targetRow = 1;
        while (getCumulativeSkinCapacity(targetRow) < K) {
          targetRow++;
        }
      }

      const cumCap = getCumulativeSkinCapacity(targetRow);
      const neededSlots = Math.max(0, cumCap - K);
      const fillSkins = excludedList.slice(0, neededSlots);
      finalSkinsToPlace = [...sortedKeptList, ...fillSkins];
    }

    if (state.bannerRowsMode === 'auto') {
      const needed = computeNeededRows(finalSkinsToPlace.length);
      if (needed !== state.bannerRows) {
        state.bannerRows = needed;
        buildInitialBannerSlots(true);
      }
    }

    // Populate empty non-crop, non-profile slots with final skins
    let skinIdx = 0;
    state.bannerSlots.forEach(slot => {
      // Don't overwrite slots that have cropped profile images or generated cards
      if (slot.type === 'crop') return;
      if (isReservedProfileSlot(slot)) return;

      if (skinIdx < finalSkinsToPlace.length) {
        slot.type = 'skin';
        slot.skin = finalSkinsToPlace[skinIdx];
        skinIdx++;
      } else {
        slot.type = 'empty';
        slot.skin = null;
      }
    });

    renderBannerGrid();
  }

  function renderBannerGrid() {
    const cardW = state.zoomCardW || 160;
    const cardH = Math.round(cardW * 1.569565);

    bannerWrapper.style.gridTemplateColumns = `repeat(15, ${cardW}px)`;
    bannerWrapper.style.gridAutoRows = `${cardH}px`;

    let html = '';
    state.bannerSlots.forEach((slot, idx) => {
      const isBig2x2 = (slot.colspan === 2 && slot.rowspan === 2);
      const isDouble = (slot.colspan === 2 && slot.rowspan === 1);
      const slotClass = isBig2x2 ? 'slot-big-2x2' : (isDouble ? 'slot-double' : '');

      if (slot.type === 'crop' && slot.dataUrl) {
        html += `
          <div class="banner-slot ${slotClass}" 
               data-idx="${idx}" 
               draggable="true" 
               ondragstart="window.onSlotDragStart(event, ${idx})"
               ondragover="window.onSlotDragOver(event)"
               ondrop="window.onSlotDrop(event, ${idx})">
            <img class="banner-slot-img" src="${slot.dataUrl}" alt="${slot.slotName || 'Crop'}">
            <div class="banner-slot-badge">${slot.slotName || 'Profile Info'}</div>
            <button class="banner-slot-remove" onclick="window.clearSlot(${idx})">&times;</button>
          </div>
        `;
      } else if (slot.type === 'skin' && slot.skin) {
        html += `
          <div class="banner-slot ${slotClass}" 
               data-idx="${idx}" 
               draggable="true"
               ondragstart="window.onSlotDragStart(event, ${idx})"
               ondragover="window.onSlotDragOver(event)"
               ondrop="window.onSlotDrop(event, ${idx})">
            <img class="banner-slot-img" src="${slot.skin.web_path}" alt="${slot.skin.skin_name}">
            <button class="banner-slot-remove" onclick="window.clearSlot(${idx})">&times;</button>
          </div>
        `;
      } else {
        // Empty slot placeholder
        let placeholderText = `Ô #${idx + 1}`;
        if (slot.row === 0 && slot.col === 0 && isBig2x2) {
          placeholderText = `⭐ Khối Lớn 2x2:<br>Avatar & Thông Tin To<br>(Chờ cắt ảnh)`;
        } else if (state.profileLayout === 'big_2x2' && slot.row === 0 && slot.col === 2) {
          placeholderText = `Số Tướng & Trang Phục<br>(Cạnh 2x2 - Ở Trên)<br>✨ Tự động tạo`;
        } else if (state.profileLayout === 'big_2x2' && slot.row === 1 && slot.col === 2) {
          placeholderText = `Tài Nguyên (Quân Huy...)<br>(Cạnh 2x2 - Ở Dưới)<br>✨ Tự động tạo`;
        } else if (slot.row === 0 && slot.col === 0 && isDouble) {
          placeholderText = `Avatar & Tên Đôi 2x1<br>(Chờ cắt ảnh)`;
        } else if (slot.row === 0 && slot.col === 0) {
          placeholderText = `Ô 1: Avatar & Tên<br>(Chờ cắt ảnh)`;
        } else if (slot.row === 0 && slot.col === 1) {
          placeholderText = `Ô 2: Số Tướng & Trang Phục<br>(Tự động tạo)`;
        }

        html += `
          <div class="banner-slot ${slotClass}" 
               data-idx="${idx}"
               ondragover="window.onSlotDragOver(event)"
               ondrop="window.onSlotDrop(event, ${idx})"
               onclick="window.clickEmptySlot(${idx})">
            <div class="banner-slot-placeholder">${placeholderText}</div>
          </div>
        `;
      }
    });

    bannerWrapper.innerHTML = html;
  }

  // Drag and drop between banner slots
  let draggedSlotIndex = null;
  window.onSlotDragStart = (e, idx) => {
    draggedSlotIndex = idx;
    e.dataTransfer.setData('text/plain', idx);
  };

  window.onSlotDragOver = (e) => {
    e.preventDefault();
  };

  window.onSlotDrop = (e, targetIdx) => {
    e.preventDefault();
    if (draggedSlotIndex === null || draggedSlotIndex === targetIdx) return;

    // Swap slots content
    const sourceSlot = state.bannerSlots[draggedSlotIndex];
    const targetSlot = state.bannerSlots[targetIdx];

    // Don't swap if one is double slot and other is single slot
    if (sourceSlot.colspan !== targetSlot.colspan) {
      alert('Không thể tráo đổi giữa ô đơn (1 cột) và ô đôi (2 cột)!');
      return;
    }

    const temp = {
      type: sourceSlot.type,
      skin: sourceSlot.skin,
      dataUrl: sourceSlot.dataUrl,
      slotName: sourceSlot.slotName,
      slotId: sourceSlot.slotId
    };

    sourceSlot.type = targetSlot.type;
    sourceSlot.skin = targetSlot.skin;
    sourceSlot.dataUrl = targetSlot.dataUrl;
    sourceSlot.slotName = targetSlot.slotName;
    sourceSlot.slotId = targetSlot.slotId;

    targetSlot.type = temp.type;
    targetSlot.skin = temp.skin;
    targetSlot.dataUrl = temp.dataUrl;
    targetSlot.slotName = temp.slotName;
    targetSlot.slotId = temp.slotId;

    draggedSlotIndex = null;
    renderBannerGrid();
  };

  window.clearSlot = (idx) => {
    const slot = state.bannerSlots[idx];
    if (slot) {
      if (slot.type === 'skin' && slot.skin) {
        state.selectedSkins.delete(slot.skin.id);
        const card = document.getElementById(`skin-card-${slot.skin.id}`);
        if (card) card.classList.remove('selected');
        updateSelectedCountUI();
      }
      slot.type = 'empty';
      slot.skin = null;
      delete slot.dataUrl;
      delete slot.slotName;
      delete slot.slotId;
      renderBannerGrid();
    }
  };

  window.clickEmptySlot = (idx) => {
    // If user clicks an empty profile slot, jump to Tab 1
    const slot = state.bannerSlots[idx];
    if (slot && (slot.row <= 1 && slot.col <= 1)) {
      switchTab('tab-crop');
    } else {
      switchTab('tab-skins');
    }
  };

  // =========================================================================
  // 5. STEP 4: XUẤT ẢNH GHÉP (COMPOSITE BANNER EXPORT)
  // =========================================================================
  const exportModal = document.getElementById('export-modal');
  const exportPreviewImg = document.getElementById('export-preview-img');
  const exportInfoEl = document.getElementById('export-info');
  const btnDownloadExported = document.getElementById('btn-download-exported');
  const btnCloseExportModal = document.getElementById('btn-close-export-modal');
  const btnCloseExportBtn = document.getElementById('btn-close-export-btn');

  btnCloseExportModal.addEventListener('click', () => exportModal.classList.remove('active'));
  btnCloseExportBtn.addEventListener('click', () => exportModal.classList.remove('active'));

  // Export Button: Client Canvas Render (Instant 4K PNG)
  document.getElementById('btn-export-canvas').addEventListener('click', () => {
    exportBannerCanvas();
  });

  async function exportBannerCanvas() {
    loadingText.textContent = "Đang tổng hợp và ghép ảnh độ phân giải cao...";
    loadingOverlay.classList.remove('hidden');

    try {
      const cardW = 230;
      const cardH = 361;
      const gap = 3;
      const cols = state.bannerCols;

      // Auto-trim to only rows that have content (at least 2 rows for profile)
      const rows = getActiveRowsCount();

      const totalW = cols * cardW + (cols + 1) * gap;
      const totalH = rows * cardH + (rows + 1) * gap;

      const canvas = document.createElement('canvas');
      canvas.width = totalW;
      canvas.height = totalH;
      const ctx = canvas.getContext('2d');

      // 1. Draw Background
      ctx.fillStyle = '#060e26';
      ctx.fillRect(0, 0, totalW, totalH);

      // Helper to load image
      const loadImage = (src) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = src;
        });
      };

      // 2. Load slot images only for active rows (row < rows)
      const loadPromises = state.bannerSlots
        .filter(slot => slot.row < rows)
        .map(async (slot) => {
          let src = null;
          if (slot.type === 'crop' && slot.dataUrl) {
            src = slot.dataUrl;
          } else if (slot.type === 'skin' && slot.skin) {
            src = slot.skin.web_path;
          }
          if (!src) return { slot, img: null };
          const img = await loadImage(src);
          return { slot, img };
        });

      const loadedItems = await Promise.all(loadPromises);

      // 3. Draw each slot image onto canvas
      loadedItems.forEach(({ slot, img }) => {
        if (slot.row >= rows) return;
        const x = gap + slot.col * (cardW + gap);
        const y = gap + slot.row * (cardH + gap);
        const w = slot.colspan * cardW + (slot.colspan - 1) * gap;
        const h = slot.rowspan * cardH + (slot.rowspan - 1) * gap;

        if (img) {
          ctx.drawImage(img, x, y, w, h);
        } else {
          // Empty slot background
          ctx.fillStyle = '#070f2b';
          ctx.fillRect(x, y, w, h);
        }
      });

      // 4. Draw Electric Neon Blue Grid Lines (Matching Reference Image)
      ctx.strokeStyle = '#1872ff';
      ctx.lineWidth = gap;

      // Outer frame
      ctx.strokeRect(gap / 2, gap / 2, totalW - gap, totalH - gap);

      // Horizontal lines
      for (let r = 1; r < rows; r++) {
        const lineY = r * (cardH + gap) + gap / 2;
        ctx.beginPath();
        if (state.profileLayout === 'big_2x2' && r === 1) {
          ctx.moveTo(2 * (cardW + gap), lineY);
        } else {
          ctx.moveTo(0, lineY);
        }
        ctx.lineTo(totalW, lineY);
        ctx.stroke();
      }

      // Vertical lines
      for (let c = 1; c < cols; c++) {
        const lineX = c * (cardW + gap) + gap / 2;
        ctx.beginPath();
        if (state.profileLayout === 'big_2x2' && c === 1) {
          ctx.moveTo(lineX, 2 * (cardH + gap));
          ctx.lineTo(lineX, totalH);
        } else if (state.profileLayout === 'wide_2x1' && c === 1) {
          ctx.moveTo(lineX, 2 * (cardH + gap));
          ctx.lineTo(lineX, totalH);
        } else if (state.profileLayout === 'standard' && c === 1) {
          ctx.moveTo(lineX, 0);
          ctx.lineTo(lineX, (cardH + gap));
          ctx.moveTo(lineX, 2 * (cardH + gap));
          ctx.lineTo(lineX, totalH);
        } else {
          ctx.moveTo(lineX, 0);
          ctx.lineTo(lineX, totalH);
        }
        ctx.stroke();
      }

      // Convert to blob and show modal
      canvas.toBlob((blob) => {
        loadingOverlay.classList.add('hidden');
        const url = URL.createObjectURL(blob);
        exportPreviewImg.src = url;
        btnDownloadExported.href = url;
        btnDownloadExported.download = `LienQuan_Banner_${Date.now()}.png`;
        exportInfoEl.textContent = `Độ phân giải siêu nét: ${totalW} × ${totalH} px (${(blob.size / 1024 / 1024).toFixed(2)} MB)`;
        exportModal.classList.add('active');
      }, 'image/png');

    } catch (err) {
      loadingOverlay.classList.add('hidden');
      alert('Lỗi xuất ảnh: ' + err.message);
      console.error(err);
    }
  }

  // Export via Python Pillow Backend (`POST /api/export-banner`)
  document.getElementById('btn-export-pil').addEventListener('click', async () => {
    loadingText.textContent = "Python Server đang render ảnh ghép 4K...";
    loadingOverlay.classList.remove('hidden');

    try {
      const exportRows = getActiveRowsCount();
      const payload = {
        cols: state.bannerCols,
        rows: exportRows,
        profileLayout: state.profileLayout,
        slots: state.bannerSlots
          .filter(s => s.row < exportRows)
          .map(s => ({
            row: s.row,
            col: s.col,
            colspan: s.colspan,
            rowspan: s.rowspan,
            type: s.type,
            data: s.dataUrl || null,
            rel_path: s.skin?.rel_path || null
          }))
      };

      const res = await fetch('/api/export-banner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      loadingOverlay.classList.add('hidden');

      if (data.status === 'ok') {
        exportPreviewImg.src = data.download_url;
        btnDownloadExported.href = data.download_url;
        btnDownloadExported.download = data.filename;
        exportInfoEl.textContent = `Độ phân giải: ${data.width} × ${data.height} px (Server render hoàn tất)`;
        exportModal.classList.add('active');
      } else {
        alert('Server báo lỗi: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      loadingOverlay.classList.add('hidden');
      alert('Lỗi kết nối server: ' + err.message);
    }
  });

  // Start app
  loadData();
});
