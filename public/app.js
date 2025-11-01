// app.js (수정 완료 버전)

const reportForm = document.getElementById("reportForm");
const descriptionEl = document.getElementById("description");
const photoEl = document.getElementById("photo");
const getLocationBtn = document.getElementById("getLocationBtn");
const locationInfo = document.getElementById("locationInfo");
const formMsg = document.getElementById("formMsg");
const reportsList = document.getElementById("reportsList");

let currentLat = null;
let currentLng = null;

const needsLocalApiProxy = /(localhost|127\.0\.0\.1):5500/.test(
	window.location.host
);
const API_BASE = "http://localhost:3000";

const defaultMapCenter = [37.5665, 126.978]; // 서울 시청 좌표
const defaultMapZoom = 12;
let mapInstance = null;
let reportsLayer = null;
let userMarker = null;

function setupMap() {
	const mapElement = document.getElementById("map");
	if (!mapElement || typeof L === "undefined") return;

	mapInstance = L.map(mapElement, {
		center: defaultMapCenter,
		zoom: defaultMapZoom,
		scrollWheelZoom: false,
	});

	L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
		maxZoom: 19,
		attribution:
			'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> 기여자',
	}).addTo(mapInstance);

	reportsLayer = L.layerGroup().addTo(mapInstance);

	mapElement.addEventListener("mouseenter", () => {
		if (mapInstance) mapInstance.scrollWheelZoom.enable();
	});
	mapElement.addEventListener("mouseleave", () => {
		if (mapInstance) mapInstance.scrollWheelZoom.disable();
	});
}

function showUserOnMap(lat, lng) {
	if (!mapInstance) return;
	const coords = [lat, lng];
	if (!userMarker) {
		userMarker = L.circleMarker(coords, {
			radius: 10,
			color: "#2b8cff",
			weight: 2,
			fillColor: "#2b8cff",
			fillOpacity: 0.6,
		});
		userMarker.addTo(mapInstance).bindTooltip("내 위치", { permanent: false });
	} else {
		userMarker.setLatLng(coords);
	}
	mapInstance.setView(coords, 15);
}

function resetUserMarker() {
	if (mapInstance && userMarker) {
		mapInstance.removeLayer(userMarker);
		userMarker = null;
	}
}

function updateReportsMapMarkers(reports = []) {
	if (!mapInstance || !reportsLayer) return;
	reportsLayer.clearLayers();
	const bounds = [];
	reports.forEach((report) => {
		const lat =
			typeof report.lat === "number" ? report.lat : parseFloat(report.lat);
		const lng =
			typeof report.lng === "number" ? report.lng : parseFloat(report.lng);
		if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

		const marker = L.marker([lat, lng]);
		const description = escapeHtml(report.description || "설명 없음");
		const time = escapeHtml(new Date(report.createdAt).toLocaleString());
		marker.bindPopup(`<strong>${description}</strong><br>${time}`);
		marker.addTo(reportsLayer);
		bounds.push([lat, lng]);
	});

	const userCoords = userMarker ? userMarker.getLatLng() : null;
	if (userCoords) bounds.push([userCoords.lat, userCoords.lng]);

	if (bounds.length) {
		mapInstance.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
	} else {
		mapInstance.setView(defaultMapCenter, defaultMapZoom);
	}
}

// ✅ 메시지 표시 함수
function showMsg(msg, isError = false) {
	formMsg.textContent = msg;
	formMsg.style.color = isError ? "crimson" : "green";
	setTimeout(() => {
		formMsg.textContent = "";
	}, 4000);
}

// ✅ 위치 버튼 동작
getLocationBtn.addEventListener("click", () => {
	if (!navigator.geolocation) {
		locationInfo.textContent = "위치 정보를 사용할 수 없습니다.";
		return;
	}
	locationInfo.textContent = "위치 가져오는 중...";
	navigator.geolocation.getCurrentPosition(
		(pos) => {
			currentLat = pos.coords.latitude;
			currentLng = pos.coords.longitude;
			locationInfo.textContent = `위치: ${currentLat.toFixed(
				6
			)}, ${currentLng.toFixed(6)}`;
			showUserOnMap(currentLat, currentLng);
		},
		(err) => {
			locationInfo.textContent = "위치 접근 거부됨 또는 오류";
		},
		{ enableHighAccuracy: true, timeout: 10000 }
	);
});

function autoLocateUserOnInit() {
	if (!navigator.geolocation) return;
	navigator.geolocation.getCurrentPosition(
		(pos) => {
			currentLat = pos.coords.latitude;
			currentLng = pos.coords.longitude;
			locationInfo.textContent = `위치: ${currentLat.toFixed(
				6
			)}, ${currentLng.toFixed(6)}`;
			showUserOnMap(currentLat, currentLng);
		},
		() => {
			// 위치 접근이 거부되면 기본 위치 유지
		},
		{ enableHighAccuracy: true, timeout: 5000 }
	);
}

async function parseJsonResponse(res, fallbackMessage) {
	const contentType = res.headers.get("content-type") || "";
	if (!contentType.includes("application/json")) {
		const text = await res.text();
		const message = text.trim();
		const looksLikeHtml = /^<!DOCTYPE|<html|<body/i.test(message);
		throw new Error(
			looksLikeHtml
				? fallbackMessage ||
				  `서버가 올바른 데이터를 보내지 않았습니다. (상태 코드: ${res.status})`
				: message ||
				  fallbackMessage ||
				  `서버가 올바른 데이터를 보내지 않았습니다. (상태 코드: ${res.status})`
		);
	}
	try {
		return await res.json();
	} catch (err) {
		throw new Error(
			fallbackMessage ||
			`서버 응답을 처리하는 중 문제가 발생했습니다. (상태 코드: ${res.status})`
		);
	}
}

// ✅ 신고 전송
reportForm.addEventListener("submit", async (e) => {
	e.preventDefault();
	const desc = descriptionEl.value.trim();
	const file = photoEl.files[0];

	if (!desc && !file) {
		showMsg("설명이나 사진 중 하나는 필요합니다.", true);
		return;
	}

	const formData = new FormData();
	formData.append("description", desc);
	if (file) formData.append("photo", file);
	if (currentLat && currentLng) {
		formData.append("lat", currentLat);
		formData.append("lng", currentLng);
	}

	const submitBtn = reportForm.querySelector("button.primary");
	submitBtn.disabled = true;
	submitBtn.textContent = "전송 중...";

	try {
		const res = await fetch(`${API_BASE}/api/report`, {
			method: "POST",
			body: formData,
			cache: "no-store",
		});
		const data = await parseJsonResponse(
			res,
			"서버 응답을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
		);
		if (!res.ok) {
			throw new Error(
				data?.error ||
				data?.message ||
				"신고 전송에 실패했습니다. 잠시 후 다시 시도해주세요."
			);
		}
		showMsg("신고가 접수되었습니다.");
		reportForm.reset();
		currentLat = currentLng = null;
		locationInfo.textContent = "위치: 없음";
		loadReports();
	} catch (err) {
		showMsg(err.message || "오류", true);
	} finally {
		submitBtn.disabled = false;
		submitBtn.textContent = "신고 전송";
	}
});

// ✅ 추가된 부분: reset 시 폼 상태/화면 초기화
reportForm.addEventListener("reset", () => {
	currentLat = null;
	currentLng = null;
	locationInfo.textContent = "위치: 없음";
	formMsg.textContent = "";
	resetUserMarker();
	if (
		mapInstance &&
		reportsLayer &&
		reportsLayer.getLayers().length === 0
	) {
		mapInstance.setView(defaultMapCenter, defaultMapZoom);
	}
});

// ✅ 신고 목록 불러오기
async function loadReports() {
	reportsList.innerHTML = "불러오는 중…";
	try {
		const res = await fetch(`${API_BASE}/api/reports`, {
			cache: "no-store",
		});
		const data = await parseJsonResponse(
			res,
			"신고 목록을 불러오지 못했습니다. 잠시 후 다시 시도해주세요."
		);
		if (!res.ok) {
			throw new Error(
				data?.error ||
				"신고 목록 요청이 실패했습니다. 잠시 후 다시 시도해주세요."
			);
		}
		if (!data.reports || data.reports.length === 0) {
			reportsList.innerHTML =
				'<div class="muted">신고 내역이 없습니다.</div>';
			updateReportsMapMarkers([]);
			return;
		}
		reportsList.innerHTML = "";
		data.reports.forEach((r) => {
			const div = document.createElement("div");
			div.className = "report";
			const photoSrc = r.photo ? `${API_BASE}${r.photo}` : null;
			div.innerHTML = `
        ${
			r.photo
				? `<img src="${photoSrc}" alt="photo">`
				: `<div style="width:120px;height:80px;background:#f0f0f0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#aaa">사진 없음</div>`
		}
        <div class="meta">
          <div><strong>${escapeHtml(
				r.description || "설명 없음"
			)}</strong></div>
          <div class="time">${new Date(r.createdAt).toLocaleString()}</div>
          <div>위치: ${
				r.lat && r.lng
					? `${r.lat.toFixed(6)}, ${r.lng.toFixed(6)}`
					: "제공 안됨"
			}</div>
        </div>
        <div class="actions">
          <div class="badge ${r.resolved ? "resolved" : "pending"}">
            ${r.resolved ? "처리됨" : "미처리"}
          </div>
          <button data-id="${r.id}" class="toggleBtn">
            ${r.resolved ? "미처리로" : "처리로"}
          </button>
        </div>
      `;
			reportsList.appendChild(div);
		});

		// 처리 상태 토글 버튼 연결
		document.querySelectorAll(".toggleBtn").forEach((btn) => {
			btn.addEventListener("click", async () => {
				const id = btn.dataset.id;
				btn.disabled = true;
				try {
					await fetch(`${API_BASE}/api/report/${id}/toggle`, {
						method: "POST",
						cache: "no-store",
					});
					loadReports();
				} catch (e) {
					alert("오류 발생");
				} finally {
					btn.disabled = false;
				}
			});
		});
		updateReportsMapMarkers(data.reports);
	} catch (err) {
		reportsList.innerHTML = `<div class="muted">불러오지 못했습니다.<br><small>${escapeHtml(err.message || "오류가 발생했습니다.")}</small></div>`;
		updateReportsMapMarkers([]);
	}
}

// ✅ HTML escape helper
function escapeHtml(s) {
	if (!s) return "";
	return s.replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			}[c])
	);
}

// ✅ 초기 실행
setupMap();
autoLocateUserOnInit();
loadReports();
