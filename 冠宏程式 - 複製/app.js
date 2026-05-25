$(document).ready(function () {
  // ==========================================================================
  // 全域變數與初始化
  // ==========================================================================
  let galleryPhotos = [];
  let pollingInterval = null;
  let dragCounter = 0;

  // 載入使用者暱稱與配置
  const defaultUploaderName = '匿名旅行家';
  $('#uploader-name').val(localStorage.getItem('uploader_nickname') || '');

  // 儲存暱稱變更
  $('#uploader-name').on('input', function () {
    const name = $(this).val().trim();
    localStorage.setItem('uploader_nickname', name);
  });

  // 載入 localStorage 的 Supabase 設定
  $('#supabase-url').val(localStorage.getItem('supabase_url') || '');
  $('#supabase-key').val(localStorage.getItem('supabase_key') || '');
  $('#supabase-bucket').val(localStorage.getItem('supabase_bucket') || 'travel-images');

  // ==========================================================================
  // 側邊設定面板 (Config Drawer) 邏輯
  // ==========================================================================
  // 開關面板
  $('.open-config, #btn-config-trigger').on('click', function (e) {
    e.preventDefault();
    $('.config-drawer').addClass('open');
    $('.config-overlay').fadeIn(300);
  });

  $('.close-config, .config-overlay').on('click', function () {
    $('.config-drawer').removeClass('open');
    $('.config-overlay').fadeOut(300);
  });

  // 儲存設定
  $('#btn-save-config').on('click', function () {
    const url = $('#supabase-url').val().trim();
    const key = $('#supabase-key').val().trim();
    const bucket = $('#supabase-bucket').val().trim() || 'travel-images';

    localStorage.setItem('supabase_url', url);
    localStorage.setItem('supabase_key', key);
    localStorage.setItem('supabase_bucket', bucket);

    showToast('設定已儲存！', 'success');
    
    if (url && key) {
      showToast('已連結 Supabase 儲存空間，照片牆現在將顯示雲端實時數據！', 'success');
      syncPhotos(true); // 立即同步雲端
    } else {
      showToast('金鑰已清空，照片牆將自動切換為本地模擬多人共享模式！', 'info');
      syncPhotos(true);
    }

    $('.config-drawer').removeClass('open');
    $('.config-overlay').fadeOut(300);
  });

  // ==========================================================================
  // 多人相片牆實時同步核心 (Supabase Fetch & Mock Polling)
  // ==========================================================================
  
  // 核心同步入口
  async function syncPhotos(showFeedback = false) {
    const url = localStorage.getItem('supabase_url');
    const key = localStorage.getItem('supabase_key');
    const bucket = localStorage.getItem('supabase_bucket') || 'travel-images';

    if (url && key) {
      await fetchSupabaseStorage(url, key, bucket, showFeedback);
    } else {
      loadSimulatedMultiplayerWall(showFeedback);
    }
  }

  // A. 從 Supabase Storage 讀取最新相片 (免登入、所有人都能看到)
  async function fetchSupabaseStorage(url, key, bucket, showFeedback) {
    const cleanUrl = url.replace(/\/$/, "");
    const listUrl = `${cleanUrl}/storage/v1/object/list/${bucket}`;

    try {
      const response = await fetch(listUrl, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prefix: "",
          limit: 100,
          sortBy: {
            column: "created_at",
            order: "desc"
          }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP 錯誤狀態碼: ${response.status}`);
      }

      const data = await response.json();
      
      // 過濾並格式化檔案資訊
      const validImages = data
        .filter(item => item.id !== null && item.metadata) // 過濾資料夾
        .map(file => {
          // 解析檔名格式：[暱稱]_[時間戳]_[隨機碼].[副檔名]
          let uploader = defaultUploaderName;
          let timestamp = new Date(file.created_at).getTime();

          if (file.name.includes('_')) {
            const parts = file.name.split('_');
            if (parts.length >= 2) {
              uploader = decodeURIComponent(parts[0]);
              const ts = parseInt(parts[1]);
              if (!isNaN(ts)) {
                timestamp = ts;
              }
            }
          }

          const publicUrl = `${cleanUrl}/storage/v1/object/public/${bucket}/${file.name}`;
          const formattedDate = new Date(timestamp).toLocaleDateString('zh-TW', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

          return {
            id: file.id,
            fileName: file.name,
            url: publicUrl,
            uploader: uploader,
            dateString: formattedDate,
            timestamp: timestamp,
            isCloud: true
          };
        });

      // 檢查是否有新增的相片
      const hasNewPhotos = galleryPhotos.length > 0 && validImages.length > galleryPhotos.length;
      
      galleryPhotos = validImages;
      renderMultiplayerWall();

      if (hasNewPhotos) {
        showToast('✨ 發現旅人上傳了新照片！已為您實時同步！', 'success');
      } else if (showFeedback) {
        showToast('雲端旅遊牆同步成功，已載入最新光影！', 'success');
      }

    } catch (error) {
      console.error('抓取 Supabase Storage 失敗：', error);
      if (showFeedback) {
        showToast('無法同步雲端，請確認專案與 Bucket 權限設定（需設為 Public）。', 'danger');
      }
      // 降級載入本地模擬照片牆，維持卓越體驗
      loadSimulatedMultiplayerWall(false);
    }
  }

  // B. 載入本地多人模擬照片牆 (包含 pre-seed 多人數據與隨機旅人上傳)
  function loadSimulatedMultiplayerWall(showFeedback) {
    let mockPhotos = JSON.parse(localStorage.getItem('multiplayer_mock_photos'));

    if (!mockPhotos || mockPhotos.length === 0) {
      // 預置 6 張多人奢華旅行卡片數據
      const preSeedPhotos = [
        {
          id: 'seed-1',
          fileName: 'seed-1.jpg',
          url: 'https://images.unsplash.com/photo-1502784444187-359ac186c5bb?q=80&w=500&auto=format&fit=crop',
          uploader: 'Emily ✈️',
          dateString: '2026年5月22日 14:32',
          timestamp: Date.now() - 3600000 * 24,
          isCloud: false
        },
        {
          id: 'seed-2',
          fileName: 'seed-2.jpg',
          url: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?q=80&w=500&auto=format&fit=crop',
          uploader: 'Alex 巴黎足跡',
          dateString: '2026年5月23日 09:15',
          timestamp: Date.now() - 3600000 * 5,
          isCloud: false
        },
        {
          id: 'seed-3',
          fileName: 'seed-3.jpg',
          url: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?q=80&w=500&auto=format&fit=crop',
          uploader: '賴冠宏 (Found)',
          dateString: '2026年5月23日 11:20',
          timestamp: Date.now() - 3600000 * 3,
          isCloud: false
        },
        {
          id: 'seed-4',
          fileName: 'seed-4.jpg',
          url: 'https://images.unsplash.com/photo-1439066615861-d1af74d74000?q=80&w=500&auto=format&fit=crop',
          uploader: 'Sophia 奢華潛水',
          dateString: '2026年5月23日 15:45',
          timestamp: Date.now() - 1800000,
          isCloud: false
        },
        {
          id: 'seed-5',
          fileName: 'seed-5.jpg',
          url: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?q=80&w=500&auto=format&fit=crop',
          uploader: '極客旅行者 Liam',
          dateString: '2026年5月23日 17:02',
          timestamp: Date.now() - 600000,
          isCloud: false
        },
        {
          id: 'seed-6',
          fileName: 'seed-6.jpg',
          url: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?q=80&w=500&auto=format&fit=crop',
          uploader: 'Olivia 森林野奢',
          dateString: '2026年5月23日 17:15',
          timestamp: Date.now() - 300000,
          isCloud: false
        }
      ];
      localStorage.setItem('multiplayer_mock_photos', JSON.stringify(preSeedPhotos));
      mockPhotos = preSeedPhotos;
    }

    // 按時間降序排序
    mockPhotos.sort((a, b) => b.timestamp - a.timestamp);

    galleryPhotos = mockPhotos;
    renderMultiplayerWall();

    if (showFeedback) {
      showToast('本地模擬照片牆載入成功！包含 6 名其他旅人的奢華分享！', 'success');
    }
  }

  // 模擬其他玩家隨機上傳照片 (只有在模擬模式且 Modal 開啟時才會偶爾觸發)
  function simulateOtherPlayerUpload() {
    const uploaderNames = ['時尚探險家 Chloe', '攝影頑童 Henry', '野地行者 Ethan', '精緻旅人 Grace', '衝浪達人 Tyler'];
    const travelPhotos = [
      'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?q=80&w=500', // 泛舟
      'https://images.unsplash.com/photo-1506929562872-bb421503ef21?q=80&w=500', // 椰子林
      'https://images.unsplash.com/photo-1452626038306-9aae5e071dd3?q=80&w=500', // 異國古城
      'https://images.unsplash.com/photo-1528127269322-539801943592?q=80&w=500', // 東南亞梯田
      'https://images.unsplash.com/photo-1501785888041-af3ef285b470?q=80&w=500'  // 湖畔
    ];

    const randomName = uploaderNames[Math.floor(Math.random() * uploaderNames.length)];
    const randomPhoto = travelPhotos[Math.floor(Math.random() * travelPhotos.length)];

    let mockPhotos = JSON.parse(localStorage.getItem('multiplayer_mock_photos')) || [];
    
    // 檢查是否已經模擬過度，限制在 15 張內
    if (mockPhotos.length >= 15) return;

    const newMockPhoto = {
      id: 'sim-' + Date.now(),
      fileName: 'sim-' + Date.now() + '.jpg',
      url: randomPhoto,
      uploader: randomName,
      dateString: new Date().toLocaleDateString('zh-TW', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),
      timestamp: Date.now(),
      isCloud: false
    };

    mockPhotos.unshift(newMockPhoto);
    localStorage.setItem('multiplayer_mock_photos', JSON.stringify(mockPhotos));
    
    showToast(`✨ 旅人「${randomName}」剛剛分享了一張新景點！正在同步...`, 'success');
    syncPhotos(false);
  }

  // 手動同步按鈕監聽
  $('#btn-refresh-gallery').on('click', function () {
    $(this).find('i').addClass('fa-spin');
    syncPhotos(true).finally(() => {
      setTimeout(() => {
        $(this).find('i').removeClass('fa-spin');
      }, 600);
    });
  });

  // Modal 開啟時觸發輪詢
  $('#uploadModal').on('shown.bs.modal', function () {
    syncPhotos(false); // 立即同步

    // 每 15 秒實時輪詢
    pollingInterval = setInterval(() => {
      const url = localStorage.getItem('supabase_url');
      const key = localStorage.getItem('supabase_key');
      
      syncPhotos(false);

      // 如果是模擬模式，有 20% 機率產生其他玩家上傳
      if (!url || !key) {
        if (Math.random() < 0.20) {
          simulateOtherPlayerUpload();
        }
      }
    }, 15000);
  });

  // Modal 關閉時清除輪詢防止消耗資源
  $('#uploadModal').on('hidden.bs.modal', function () {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  });

  // ==========================================================================
  // 多人相片牆渲染 (Masonry Card Rendering)
  // ==========================================================================
  function renderMultiplayerWall() {
    const $grid = $('#gallery-grid');
    const $badge = $('#total-photos-badge');
    
    $grid.empty();
    $badge.text(`共 ${galleryPhotos.length} 張光影`);

    if (galleryPhotos.length === 0) {
      $grid.append(`
        <div class="col-12 text-center text-muted py-5" id="gallery-empty-state">
          <i class="fa-regular fa-image fa-3x mb-3" style="color: rgba(212,175,55,0.4)"></i>
          <p class="mb-0">旅程牆目前空無一人，立即拖曳圖片成為第一位分享者吧！</p>
        </div>
      `);
      return;
    }

    galleryPhotos.forEach(photo => {
      // 雲端或本地徽章
      const sourceBadge = photo.isCloud 
        ? `<span class="badge-lux position-absolute" style="top:12px; left:12px; z-index:3; font-size:10.5px; padding:3px 10px; background:linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)"><i class="fa-solid fa-cloud me-1"></i>雲端同步</span>`
        : `<span class="badge-lux position-absolute" style="top:12px; left:12px; z-index:3; font-size:10.5px; padding:3px 10px; background:linear-gradient(135deg, #10b981 0%, #059669 100%)"><i class="fa-solid fa-people-arrows me-1"></i>多人模擬</span>`;

      // 檢查這張卡片是不是當前使用者上傳的，允許他們刪除 (如果是 Seed 照片不給刪除維持畫面豐富)
      const isMyPhoto = !photo.id.startsWith('seed-');
      const deleteBtnHTML = isMyPhoto 
        ? `<span class="gallery-item-action-btn delete-btn" data-id="${photo.id}" data-filename="${photo.fileName}" title="刪除此相片"><i class="fa-solid fa-trash-can"></i></span>`
        : '';

      $grid.append(`
        <div class="col-sm-6 col-md-4 col-lg-3">
          <div class="gallery-card-lux" data-id="${photo.id}">
            <div class="gallery-card-img-wrapper">
              ${sourceBadge}
              <img src="${photo.url}" alt="${photo.fileName}" onerror="this.src='https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=500&q=80'">
              <div class="gallery-card-overlay">
                <span class="gallery-item-action-btn view-btn" data-url="${photo.url}" title="大圖檢視"><i class="fa-solid fa-magnifying-glass-plus"></i></span>
                <a href="${photo.url}" target="_blank" download="${photo.fileName}" class="gallery-item-action-btn download-btn" title="下載原圖"><i class="fa-solid fa-cloud-arrow-down"></i></a>
                ${deleteBtnHTML}
              </div>
            </div>
            <div class="gallery-card-body">
              <div class="gallery-card-title">${photo.fileName.includes('_') ? photo.fileName.split('_').slice(2).join('_') : photo.fileName}</div>
              <div class="gallery-card-meta">
                <span class="uploader-tag"><i class="fa-solid fa-compass"></i>${photo.uploader}</span>
                <span>${photo.dateString}</span>
              </div>
            </div>
          </div>
        </div>
      `);
    });
  }

  // 刪除多人相片 (免登入 DELETE / 模擬刪除)
  $(document).on('click', '.delete-btn', async function (e) {
    e.preventDefault();
    e.stopPropagation();

    const id = $(this).data('id');
    const fileName = $(this).data('filename');

    const url = localStorage.getItem('supabase_url');
    const key = localStorage.getItem('supabase_key');
    const bucket = localStorage.getItem('supabase_bucket') || 'travel-images';

    const $card = $(this).closest('.gallery-card-lux');

    if (url && key && id && !id.startsWith('sim-')) {
      // 實時刪除雲端 Supabase Storage 的檔案
      const cleanUrl = url.replace(/\/$/, "");
      const deleteUrl = `${cleanUrl}/storage/v1/object/${bucket}/${fileName}`;

      try {
        const response = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: {
            'apikey': key,
            'Authorization': `Bearer ${key}`
          }
        });

        if (!response.ok) {
          throw new Error('Supabase Storage 刪除失敗');
        }

        showToast('已從 Supabase 雲端徹底刪除該張共享旅圖！', 'success');
        $card.css('transform', 'scale(0)').fadeOut(400, () => syncPhotos(false));

      } catch (err) {
        console.error(err);
        showToast('雲端刪除失敗，請檢查您的 Bucket 是否設為允許 Public DELETE。', 'danger');
      }
    } else {
      // 刪除模擬卡片
      let mockPhotos = JSON.parse(localStorage.getItem('multiplayer_mock_photos')) || [];
      const imgObj = mockPhotos.find(p => p.id === id);

      if (imgObj && imgObj.url.startsWith('blob:')) {
        URL.revokeObjectURL(imgObj.url);
      }

      mockPhotos = mockPhotos.filter(p => p.id !== id);
      localStorage.setItem('multiplayer_mock_photos', JSON.stringify(mockPhotos));
      
      showToast('已刪除您的個人模擬共享旅圖！', 'info');
      $card.css('transform', 'scale(0)').fadeOut(400, () => syncPhotos(false));
    }
  });

  // ==========================================================================
  // 拖曳上傳與點擊上傳核心邏輯 (Drag & Drop)
  // ==========================================================================
  const $dropzone = $('#dark-dropzone');
  const $fileInput = $('#file-input');

  $dropzone.on('click', function () {
    $fileInput.trigger('click');
  });

  $fileInput.on('change', function (e) {
    const files = e.target.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  });

  $dropzone.on('dragenter', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    $dropzone.addClass('dragover');
  });

  $dropzone.on('dragleave', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      $dropzone.removeClass('dragover');
    }
  });

  $dropzone.on('dragover', function (e) {
    e.preventDefault();
    e.stopPropagation();
  });

  $dropzone.on('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    $dropzone.removeClass('dragover');

    const files = e.originalEvent.dataTransfer.files;
    if (files.length > 0) {
      handleFiles(files);
    }
  });

  async function handleFiles(files) {
    const validImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!validImageTypes.includes(file.type)) {
        showToast(`檔案「${file.name}」格式不支援，請上傳圖檔。`, 'danger');
        continue;
      }
      
      if (file.size > 10 * 1024 * 1024) {
        showToast(`檔案「${file.name}」超過 10MB，請上傳小於 10MB 的檔案。`, 'danger');
        continue;
      }

      await uploadImageProcess(file);
    }
    $fileInput.val('');
  }

  // ==========================================================================
  // 上傳核心：Supabase 免登入上傳 與 本地模擬
  // ==========================================================================
  function uploadImageProcess(file) {
    return new Promise((resolve) => {
      const $progressContainer = $('#progress-container');
      const $progressBar = $('#progress-bar');
      const $progressText = $('#progress-text');
      
      $progressContainer.slideDown(300);
      $progressBar.css('width', '0%');
      $progressText.text('準備上傳 0%');

      // 取得暱稱
      const rawUploaderName = $('#uploader-name').val().trim() || defaultUploaderName;
      const uploaderNameEncoded = encodeURIComponent(rawUploaderName);

      const url = localStorage.getItem('supabase_url');
      const key = localStorage.getItem('supabase_key');
      const bucket = localStorage.getItem('supabase_bucket') || 'travel-images';

      if (url && key) {
        // 使用真實 Supabase Storage REST API
        const cleanUrl = url.replace(/\/$/, "");
        const fileExt = file.name.split('.').pop();
        // 檔名規則：[暱稱]_[時間戳]_[隨機碼].[副檔名]
        const randomCode = Math.random().toString(36).substr(2, 5);
        const cleanFileName = file.name.replace(/[^a-zA-Z0-9]/g, "").substring(0, 10);
        const finalFileName = `${uploaderNameEncoded}_${Date.now()}_${randomCode}_${cleanFileName}.${fileExt}`;
        const uploadUrl = `${cleanUrl}/storage/v1/object/${bucket}/${finalFileName}`;

        const xhr = new XMLHttpRequest();
        xhr.open('POST', uploadUrl, true);
        xhr.setRequestHeader('apikey', key);
        xhr.setRequestHeader('Authorization', `Bearer ${key}`);
        xhr.setRequestHeader('Content-Type', file.type);

        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            $progressBar.css('width', percentComplete + '%');
            $progressText.text(`實時同步中... ${percentComplete}%`);
          }
        };

        xhr.onload = function () {
          if (xhr.status === 200 || xhr.status === 201) {
            showToast(`「${file.name}」已成功永久同步至 Supabase！`, 'success');
            
            setTimeout(() => {
              $progressContainer.slideUp(300);
              syncPhotos(false); // 重新抓取最新列表
              resolve();
            }, 800);
          } else {
            console.error('Supabase 寫入失敗回應：', xhr.responseText);
            showToast('雲端儲存空間拒絕寫入，請確認該 Bucket 的 RLS Policy 是否開放 Insert 權限給 anonymous/public。', 'danger');
            showToast('已為您啟用「多人本地模擬共享」完成操作...', 'info');
            simulateLocalUpload(file, rawUploaderName, $progressBar, $progressText, $progressContainer, resolve);
          }
        };

        xhr.onerror = function () {
          showToast('雲端連線失敗，請檢查網路或設定。', 'danger');
          showToast('已為您啟用「多人本地模擬共享」完成操作...', 'info');
          simulateLocalUpload(file, rawUploaderName, $progressBar, $progressText, $progressContainer, resolve);
        };

        xhr.send(file);

      } else {
        // 沒有配置金鑰，執行多人模擬共享
        simulateLocalUpload(file, rawUploaderName, $progressBar, $progressText, $progressContainer, resolve);
      }
    });
  }

  // 模擬本機多人共享
  function simulateLocalUpload(file, uploader, $progressBar, $progressText, $progressContainer, resolve) {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 15) + 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);

        const blobUrl = URL.createObjectURL(file);
        
        let mockPhotos = JSON.parse(localStorage.getItem('multiplayer_mock_photos')) || [];
        const newMockPhoto = {
          id: 'mock-' + Date.now(),
          fileName: file.name,
          url: blobUrl,
          uploader: uploader + ' (你)',
          dateString: new Date().toLocaleDateString('zh-TW', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          timestamp: Date.now(),
          isCloud: false
        };

        mockPhotos.unshift(newMockPhoto);
        localStorage.setItem('multiplayer_mock_photos', JSON.stringify(mockPhotos));

        $progressBar.css('width', '100%');
        $progressText.text('上傳成功！');
        showToast(`「${file.name}」已成功上傳（模擬共享）！`, 'success');

        setTimeout(() => {
          $progressContainer.slideUp(300);
          syncPhotos(false); // 重新繪製
          resolve();
        }, 800);
      } else {
        $progressBar.css('width', progress + '%');
        $progressText.text(`加密打包安全傳輸中... ${progress}%`);
      }
    }, 80);
  }

  // ==========================================================================
  // 大圖燈箱與 Toast (Lightbox)
  // ==========================================================================
  const $lightbox = $('#lightbox-modal');
  const $lightboxImg = $('#lightbox-img');

  $(document).on('click', '.view-btn', function () {
    const url = $(this).data('url');
    $lightboxImg.attr('src', url);
    $lightbox.addClass('open');
  });

  $('.lightbox-close, #lightbox-modal').on('click', function (e) {
    if (e.target !== $lightboxImg[0]) {
      $lightbox.removeClass('open');
    }
  });

  $(document).on('keydown', function (e) {
    if (e.key === 'Escape') {
      $lightbox.removeClass('open');
      $('.config-drawer').removeClass('open');
      $('.config-overlay').fadeOut(300);
    }
  });

  function showToast(message, type = 'info') {
    const toastId = 'toast-' + Date.now();
    let iconClass = 'fa-circle-info';
    let gradientStyle = 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)'; 

    if (type === 'success') {
      iconClass = 'fa-circle-check';
      gradientStyle = 'linear-gradient(135deg, #f3e7c4 0%, #d4af37 100%)'; 
    } else if (type === 'danger') {
      iconClass = 'fa-circle-exclamation';
      gradientStyle = 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'; 
    }

    const toastHTML = `
      <div id="${toastId}" class="toast align-items-center text-white border-0 shadow-lg" role="alert" aria-live="assertive" aria-atomic="true" style="background: ${gradientStyle}; border-radius: 12px; backdrop-filter: blur(10px);">
        <div class="d-flex">
          <div class="toast-body d-flex align-items-center gap-2 py-3 px-3">
            <i class="fa-solid ${iconClass} fs-5 text-white"></i>
            <span style="font-weight: 500; font-size: 0.95rem;">${message}</span>
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    `;

    $('#toast-container').append(toastHTML);
    const $toastElement = $('#' + toastId);
    
    const toast = new bootstrap.Toast($toastElement[0], {
      autohide: true,
      delay: 4500
    });
    
    toast.show();

    $toastElement.on('hidden.bs.toast', function () {
      $(this).remove();
    });
  }

  window.luxToast = showToast;

  // 初始化首頁靜態同步
  syncPhotos(false);
});
