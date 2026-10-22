#include "WebGPUDevice/WebGPUD3D8.h"

#include "WebGPUDevice/WebGPUContext.h"

#include <d3d8.h>
#include <emscripten.h>

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <limits>
#include <map>
#include <memory>
#include <unordered_map>
#include <string>
#include <utility>
#include <vector>

namespace
{
constexpr UINT kDefaultWidth = 1024;
constexpr UINT kDefaultHeight = 768;
constexpr UINT kTextureStageCount = 8;
constexpr UINT kTextureStateCount = 32;
constexpr size_t kUploadFrameCount = 3;
constexpr size_t kMaxCachedBindGroups = 4096;
constexpr size_t kVertexUploadCapacity = 32 * 1024 * 1024;
constexpr size_t kIndexUploadCapacity = 4 * 1024 * 1024;
constexpr size_t kUniformUploadCapacity = 2 * 1024 * 1024;
constexpr size_t kUniformOffsetAlignment = 256;
constexpr size_t kRawVertexUploadCapacity = 32 * 1024 * 1024;
constexpr size_t kFixedFunctionUploadCapacity = 8 * 1024 * 1024;

WGPUStringView MakeStringView(const char *value)
{
	return { value, WGPU_STRLEN };
}

template<typename T>
HRESULT ReturnObject(T *object, T **output)
{
	if (!output) {
		return D3DERR_INVALIDCALL;
	}
	*output = object;
	if (object) {
		object->AddRef();
	}
	return D3D_OK;
}

// GeneralsX @bugfix zhwp 17/10/2026 A WebGPU depth-stencil attachment must be created in a depth format, never a colour one.
bool IsDepthFormat(D3DFORMAT format)
{
	return format == D3DFMT_D16 || format == D3DFMT_D24S8 || format == D3DFMT_D24X8 || format == D3DFMT_D32 ||
		format == D3DFMT_D15S1 || format == D3DFMT_D24X4S4;
}

UINT FormatRowPitch(D3DFORMAT format, UINT width)
{
	switch (format) {
		case D3DFMT_DXT1:
			return std::max(1U, (width + 3) / 4) * 8;
		case D3DFMT_DXT2:
		case D3DFMT_DXT3:
		case D3DFMT_DXT4:
		case D3DFMT_DXT5:
			return std::max(1U, (width + 3) / 4) * 16;
		case D3DFMT_A8R8G8B8:
		case D3DFMT_X8R8G8B8:
		case D3DFMT_R8G8B8:
			return width * 4;
		case D3DFMT_R5G6B5:
		case D3DFMT_A4R4G4B4:
		case D3DFMT_X4R4G4B4:
		case D3DFMT_A1R5G5B5:
		case D3DFMT_X1R5G5B5:
		case D3DFMT_A8L8:
			return width * 2;
		default:
			return width;
	}
}

UINT FormatRowCount(D3DFORMAT format, UINT height)
{
	if (format == D3DFMT_DXT1 || format == D3DFMT_DXT2 || format == D3DFMT_DXT3 ||
		format == D3DFMT_DXT4 || format == D3DFMT_DXT5) {
		return std::max(1U, (height + 3) / 4);
	}
	return height;
}

WGPUTextureFormat CompressedTextureFormat(D3DFORMAT format)
{
	switch (format) {
		case D3DFMT_DXT1: return WGPUTextureFormat_BC1RGBAUnorm;
		case D3DFMT_DXT2:
		case D3DFMT_DXT3: return WGPUTextureFormat_BC2RGBAUnorm;
		case D3DFMT_DXT4:
		case D3DFMT_DXT5: return WGPUTextureFormat_BC3RGBAUnorm;
		default: return WGPUTextureFormat_Undefined;
	}
}

void Decode565(uint16_t value, uint8_t *color)
{
	color[0] = static_cast<uint8_t>(((value >> 11) & 31) * 255 / 31);
	color[1] = static_cast<uint8_t>(((value >> 5) & 63) * 255 / 63);
	color[2] = static_cast<uint8_t>((value & 31) * 255 / 31);
	color[3] = 255;
}

void DecodeColorBlock(const uint8_t *block, bool allowTransparent, uint8_t colors[4][4])
{
	const uint16_t first = static_cast<uint16_t>(block[0] | (block[1] << 8));
	const uint16_t second = static_cast<uint16_t>(block[2] | (block[3] << 8));
	Decode565(first, colors[0]);
	Decode565(second, colors[1]);
	if (first > second || !allowTransparent) {
		for (int channel = 0; channel < 3; ++channel) {
			colors[2][channel] = static_cast<uint8_t>((2 * colors[0][channel] + colors[1][channel]) / 3);
			colors[3][channel] = static_cast<uint8_t>((colors[0][channel] + 2 * colors[1][channel]) / 3);
		}
		colors[2][3] = 255;
		colors[3][3] = 255;
	} else {
		for (int channel = 0; channel < 3; ++channel) {
			colors[2][channel] = static_cast<uint8_t>((colors[0][channel] + colors[1][channel]) / 2);
			colors[3][channel] = 0;
		}
		colors[2][3] = 255;
		colors[3][3] = 0;
	}
}

void StoreBlockPixel(std::vector<uint8_t> &rgba, UINT width, UINT height, UINT x, UINT y, const uint8_t *color)
{
	if (x >= width || y >= height) {
		return;
	}
	std::memcpy(rgba.data() + (static_cast<size_t>(y) * width + x) * 4, color, 4);
}

void DecodeDXT(const uint8_t *source, UINT width, UINT height, D3DFORMAT format, std::vector<uint8_t> &rgba)
{
	const bool dxt1 = format == D3DFMT_DXT1;
	const UINT blockBytes = dxt1 ? 8 : 16;
	const UINT blocksWide = std::max(1U, (width + 3) / 4);
	const UINT blocksHigh = std::max(1U, (height + 3) / 4);
	for (UINT blockY = 0; blockY < blocksHigh; ++blockY) {
		for (UINT blockX = 0; blockX < blocksWide; ++blockX) {
			const uint8_t *block = source + (static_cast<size_t>(blockY) * blocksWide + blockX) * blockBytes;
			const uint8_t *colorBlock = dxt1 ? block : block + 8;
			uint8_t colors[4][4] = {};
			DecodeColorBlock(colorBlock, dxt1, colors);
			uint32_t colorIndices = static_cast<uint32_t>(colorBlock[4]) |
				(static_cast<uint32_t>(colorBlock[5]) << 8) |
				(static_cast<uint32_t>(colorBlock[6]) << 16) |
				(static_cast<uint32_t>(colorBlock[7]) << 24);

			uint8_t alpha[16] = {};
			if (dxt1) {
				std::fill(std::begin(alpha), std::end(alpha), 255);
			} else if (format == D3DFMT_DXT2 || format == D3DFMT_DXT3) {
				for (UINT pixel = 0; pixel < 16; ++pixel) {
					alpha[pixel] = static_cast<uint8_t>(((block[pixel / 2] >> ((pixel & 1) * 4)) & 15) * 17);
				}
			} else {
				uint8_t values[8] = { block[0], block[1] };
				if (values[0] > values[1]) {
					for (int i = 1; i <= 6; ++i) {
						values[i + 1] = static_cast<uint8_t>(((7 - i) * values[0] + i * values[1]) / 7);
					}
				} else {
					for (int i = 1; i <= 4; ++i) {
						values[i + 1] = static_cast<uint8_t>(((5 - i) * values[0] + i * values[1]) / 5);
					}
					values[6] = 0;
					values[7] = 255;
				}
				uint64_t indices = 0;
				for (int i = 0; i < 6; ++i) {
					indices |= static_cast<uint64_t>(block[2 + i]) << (i * 8);
				}
				for (UINT pixel = 0; pixel < 16; ++pixel) {
					alpha[pixel] = values[(indices >> (pixel * 3)) & 7];
				}
			}

			for (UINT y = 0; y < 4; ++y) {
				for (UINT x = 0; x < 4; ++x) {
					const UINT pixel = y * 4 + x;
					uint8_t decoded[4];
					std::memcpy(decoded, colors[(colorIndices >> (pixel * 2)) & 3], 4);
					decoded[3] = static_cast<uint8_t>((static_cast<UINT>(decoded[3]) * alpha[pixel]) / 255);
					StoreBlockPixel(rgba, width, height, blockX * 4 + x, blockY * 4 + y, decoded);
				}
			}
		}
	}
}

void ConvertToRGBA(const uint8_t *source, UINT width, UINT height, D3DFORMAT format, std::vector<uint8_t> &rgba)
{
	rgba.assign(static_cast<size_t>(width) * height * 4, 255);
	if (format == D3DFMT_DXT1 || format == D3DFMT_DXT2 || format == D3DFMT_DXT3 ||
		format == D3DFMT_DXT4 || format == D3DFMT_DXT5) {
		DecodeDXT(source, width, height, format, rgba);
		return;
	}

	for (UINT y = 0; y < height; ++y) {
		for (UINT x = 0; x < width; ++x) {
			uint8_t *out = rgba.data() + (static_cast<size_t>(y) * width + x) * 4;
			switch (format) {
				case D3DFMT_A8R8G8B8:
				case D3DFMT_X8R8G8B8: {
					const uint8_t *in = source + (static_cast<size_t>(y) * width + x) * 4;
					out[0] = in[2];
					out[1] = in[1];
					out[2] = in[0];
					out[3] = format == D3DFMT_A8R8G8B8 ? in[3] : 255;
					break;
				}
				case D3DFMT_R5G6B5: {
					const uint16_t value = reinterpret_cast<const uint16_t *>(source)[static_cast<size_t>(y) * width + x];
					Decode565(value, out);
					break;
				}
				case D3DFMT_A4R4G4B4:
				case D3DFMT_X4R4G4B4: {
					const uint16_t value = reinterpret_cast<const uint16_t *>(source)[static_cast<size_t>(y) * width + x];
					out[0] = static_cast<uint8_t>(((value >> 8) & 15) * 17);
					out[1] = static_cast<uint8_t>(((value >> 4) & 15) * 17);
					out[2] = static_cast<uint8_t>((value & 15) * 17);
					out[3] = format == D3DFMT_A4R4G4B4 ? static_cast<uint8_t>(((value >> 12) & 15) * 17) : 255;
					break;
				}
				case D3DFMT_A1R5G5B5:
				case D3DFMT_X1R5G5B5: {
					const uint16_t value = reinterpret_cast<const uint16_t *>(source)[static_cast<size_t>(y) * width + x];
					out[0] = static_cast<uint8_t>(((value >> 10) & 31) * 255 / 31);
					out[1] = static_cast<uint8_t>(((value >> 5) & 31) * 255 / 31);
					out[2] = static_cast<uint8_t>((value & 31) * 255 / 31);
					out[3] = format == D3DFMT_A1R5G5B5 && !(value & 0x8000) ? 0 : 255;
					break;
				}
				case D3DFMT_A8L8: {
					const uint8_t *in = source + (static_cast<size_t>(y) * width + x) * 2;
					out[0] = out[1] = out[2] = in[0];
					out[3] = in[1];
					break;
				}
				case D3DFMT_A8:
					out[0] = out[1] = out[2] = 255;
					out[3] = source[static_cast<size_t>(y) * width + x];
					break;
				case D3DFMT_L8:
				default:
					out[0] = out[1] = out[2] = source[static_cast<size_t>(y) * width + x];
					out[3] = 255;
					break;
			}
		}
	}
}

struct CanonicalVertex
{
	float position[4];
	float color[4];
	float uv[4][2];
	float fog;
};

struct VertexShaderProgram;

// Everything convertVertex needs that does not change between the vertices of
// one draw: the transforms, the inverse normal matrix, the lights moved to view
// space, the vertex layout and the texture stage setup. Built once per draw by
// prepareVertexSetup, so the per-vertex path only does per-vertex arithmetic.
struct VertexSetup
{
	struct Light
	{
		DWORD type;
		float position[4];  // view space
		float direction[4]; // view space, normalized
		float range;
		float attenuation0;
		float attenuation1;
		float attenuation2;
		float falloff;
		float cosHalfTheta;
		float cosHalfPhi;
		float ambient[4];
		float diffuse[4];
	};
	enum class MaterialSource : uint8_t { Material, VertexDiffuse, VertexSpecular };
	struct TextureStage
	{
		bool cameraSpacePosition;
		bool hasTransform;
		UINT coordinateIndex;
		const D3DMATRIX *transform;
	};

	const VertexShaderProgram *program;
	DWORD fvf;
	bool rhw;
	DWORD positionType;
	D3DMATRIX world;
	D3DMATRIX view;
	D3DMATRIX projection;
	float viewportX;
	float viewportY;
	float viewportWidth;
	float viewportHeight;
	UINT positionOffset;
	bool hasNormal;
	UINT normalOffset;
	bool normalInvertible;
	float normalInverse[3][3];
	bool normalizeNormals;
	bool fogEnabled;
	DWORD fogMode;
	bool fogRange;
	float fogDensity;
	float fogStart;
	float fogEnd;
	bool fogFromSpecular;
	bool hasDiffuse;
	UINT diffuseOffset;
	bool hasSpecular;
	UINT specularOffset;
	bool lighting;
	UINT lightCount;
	Light lights[8];
	MaterialSource diffuseSource;
	MaterialSource ambientSource;
	MaterialSource emissiveSource;
	float materialDiffuse[4];
	float materialAmbient[4];
	float materialEmissive[4];
	float globalAmbient[4];
	UINT textureCount;
	UINT uvOffset[4];
	UINT uvCoordinateCount[4];
	TextureStage stages[4];
};

// The per-draw block the fixed-function vertex shader (vertex_ff) reads; it is
// a VertexSetup packed in the WGSL uniform layout. Matrices keep the Direct3D
// row-major memory, so WGSL's column-major view of them computes v * M as M * v.
struct FixedFunctionUniforms
{
	struct Light
	{
		float position[4];
		float direction[4];
		float ambient[4];
		float diffuse[4];
		float range;
		float attenuation0;
		float attenuation1;
		float attenuation2;
		float falloff;
		float cosHalfTheta;
		float cosHalfPhi;
		uint32_t type;
	};
	enum : uint32_t {
		kHasNormal = 1u << 0,
		kNormalInvertible = 1u << 1,
		kNormalizeNormals = 1u << 2,
		kFogEnabled = 1u << 3,
		kFogRange = 1u << 4,
		kHasDiffuse = 1u << 5,
		kHasSpecular = 1u << 6,
		kFogFromSpecular = 1u << 7,
		kLighting = 1u << 8,
		kPretransformed = 1u << 9,
	};
	enum : uint32_t {
		kStageCameraSpacePosition = 1u << 0,
		kStageHasTransform = 1u << 1,
		kStageCoordinateShift = 8,
	};
	D3DMATRIX world;
	D3DMATRIX view;
	D3DMATRIX projection;
	D3DMATRIX textureTransform[4];
	float normalInverse[3][4];
	float materialDiffuse[4];
	float materialAmbient[4];
	float materialEmissive[4];
	float globalAmbient[4];
	float viewportWidth;
	float viewportHeight;
	float fogDensity;
	float fogStart;
	float fogEnd;
	uint32_t flags;
	uint32_t fogMode;
	uint32_t lightCount;
	uint32_t diffuseSource;
	uint32_t ambientSource;
	uint32_t emissiveSource;
	uint32_t padding;
	uint32_t stageFlags[4];
	float viewportOrigin[4];
	Light lights[8];
};
static_assert(sizeof(FixedFunctionUniforms::Light) == 96, "WGSL FixedFunctionLight layout");

// The per-draw block a translated vs.1.1 shader (vertex_vs) reads: the 96
// constant registers and the viewport size for the half-pixel shift that
// executeVertexShader applies. It shares group 1 with FixedFunctionUniforms.
struct VertexShaderUniforms
{
	float constants[96][4];
	float viewport[4];
};
constexpr size_t kGroup1BindingSize = std::max(sizeof(FixedFunctionUniforms), sizeof(VertexShaderUniforms));
static_assert(offsetof(FixedFunctionUniforms, normalInverse) == 448, "WGSL FixedFunction layout");
static_assert(offsetof(FixedFunctionUniforms, viewportWidth) == 560, "WGSL FixedFunction layout");
static_assert(offsetof(FixedFunctionUniforms, stageFlags) == 608, "WGSL FixedFunction layout");
static_assert(offsetof(FixedFunctionUniforms, viewportOrigin) == 624, "WGSL FixedFunction layout");
static_assert(offsetof(FixedFunctionUniforms, lights) == 640, "WGSL FixedFunction layout");
static_assert(sizeof(FixedFunctionUniforms) == 1408, "WGSL FixedFunction layout");

struct TextureCombinerUniforms
{
	DWORD colorOp0;
	DWORD colorArg10;
	DWORD colorArg20;
	DWORD alphaOp0;
	DWORD alphaArg10;
	DWORD alphaArg20;
	DWORD colorOp1;
	DWORD colorArg11;
	DWORD colorArg21;
	DWORD alphaOp1;
	DWORD alphaArg11;
	DWORD alphaArg21;
	DWORD colorOp2;
	DWORD colorArg12;
	DWORD colorArg22;
	DWORD alphaOp2;
	DWORD alphaArg12;
	DWORD alphaArg22;
	DWORD colorOp3;
	DWORD colorArg13;
	DWORD colorArg23;
	DWORD alphaOp3;
	DWORD alphaArg13;
	DWORD alphaArg23;
	float textureFactor[4];
	float fogColor[4];
	float alphaRef;
	DWORD alphaFunc;
	DWORD alphaTestEnable;
	DWORD opaqueAlpha;
	DWORD pixelShaderMode;
	DWORD pixelShaderTextureCount;
	DWORD shaderPadding0;
	DWORD shaderPadding1;
};

static_assert(sizeof(TextureCombinerUniforms) == 160);

struct PixelShaderProgram
{
	DWORD mode;
	DWORD textureCount;
};

struct PixelShaderInstruction
{
	DWORD opcode;
	std::array<DWORD, 4> parameters;
	UINT parameterCount;
};

struct VertexDeclarationElement
{
	DWORD vertexRegister;
	DWORD dataType;
	UINT offset;
};

struct VertexShaderInstruction
{
	DWORD opcode;
	DWORD destination;
	std::array<DWORD, 3> sources;
	UINT sourceCount;
};

struct VertexShaderProgram
{
	DWORD handle = 0;
	std::vector<DWORD> declaration;
	std::vector<DWORD> function;
	std::vector<VertexDeclarationElement> elements;
	std::vector<VertexShaderInstruction> instructions;
};

class WebGPUD3DDevice;
class WebGPUTexture;

// A mirror buffer taken out of use, with what it takes to reuse it.
struct RetiredBuffer
{
	WGPUBuffer buffer;
	size_t size;
	WGPUBufferUsage usage;
};

// The most retired mirror buffers the device keeps for reuse.
constexpr size_t kMaxPooledBuffers = 24;

// A GPU copy of a vertex or index buffer, so draws read geometry without a
// per-draw copy. Lock marks the bytes it hands out as dirty, with the lock
// flags; WebGPUD3DDevice::syncMirror uploads them before the next draw.
struct GpuBufferMirror
{
	WGPUBuffer buffer = nullptr;
	bool dirty = true;
	// A D3DLOCK_DISCARD lock dropped the old contents.
	bool discarded = false;
	size_t dirtyBegin = 0;
	size_t dirtyEnd = SIZE_MAX;
	// The frame whose draws read the buffer, and the bytes they read.
	uint64_t usedFrame = UINT64_MAX;
	size_t usedBegin = 0;
	size_t usedEnd = 0;
	// Bytes synced for this frame's draws but not written yet: syncMirror
	// gathers them so one queue write per buffer goes out before the submit.
	bool pending = false;
	size_t pendingBegin = 0;
	size_t pendingEnd = 0;
	const uint8_t *source = nullptr;
	size_t sourceSize = 0;
	// What the GPU buffer holds once the queued writes land, kept for buffers
	// the game rewrites every frame so writeMirror sends only changed blocks.
	// Empty while unknown; a buffer that replaced a DISCARDed one never gets
	// one, since only the bytes written since then are known.
	std::vector<uint8_t> shadow;
	bool renamed = false;
	uint64_t lastWriteFrame = UINT64_MAX;
	unsigned writeFrames = 0;

	// Whether a Lock of [begin, end) may change bytes still waiting to be
	// written, counting the 4-byte rounding writeMirror applies.
	bool pendingOverlaps(size_t begin, size_t end) const
	{
		return pending && begin < ((pendingEnd + 3) & ~static_cast<size_t>(3)) && end > (pendingBegin & ~static_cast<size_t>(3));
	}
	void markDirty(size_t begin, size_t end, DWORD flags)
	{
		dirtyBegin = dirty ? std::min(dirtyBegin, begin) : begin;
		dirtyEnd = dirty ? std::max(dirtyEnd, end) : end;
		discarded = (dirty && discarded) || (flags & D3DLOCK_DISCARD) != 0;
		dirty = true;
	}
	~GpuBufferMirror()
	{
		if (buffer) wgpuBufferRelease(buffer);
	}
};

class WebGPUVertexBuffer final : public IDirect3DVertexBuffer8
{
public:
	WebGPUVertexBuffer(WebGPUD3DDevice *device, UINT length, DWORD usage, DWORD fvf, D3DPOOL pool);
	~WebGPUVertexBuffer();

	HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, void **output) override;
	ULONG STDMETHODCALLTYPE AddRef() override;
	ULONG STDMETHODCALLTYPE Release() override;
	HRESULT STDMETHODCALLTYPE GetDevice(IDirect3DDevice8 **device) override;
	HRESULT STDMETHODCALLTYPE SetPrivateData(REFGUID, const void *, DWORD, DWORD) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE GetPrivateData(REFGUID, void *, DWORD *) override { return D3DERR_NOTFOUND; }
	HRESULT STDMETHODCALLTYPE FreePrivateData(REFGUID) override { return D3DERR_NOTFOUND; }
	DWORD STDMETHODCALLTYPE SetPriority(DWORD priority) override { return std::exchange(m_priority, priority); }
	DWORD STDMETHODCALLTYPE GetPriority() override { return m_priority; }
	void STDMETHODCALLTYPE PreLoad() override {}
	D3DRESOURCETYPE STDMETHODCALLTYPE GetType() override { return D3DRTYPE_VERTEXBUFFER; }
	HRESULT STDMETHODCALLTYPE Lock(UINT offset, UINT size, BYTE **data, DWORD flags) override;
	HRESULT STDMETHODCALLTYPE Unlock() override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE GetDesc(D3DVERTEXBUFFER_DESC *desc) override;

	const uint8_t *data() const { return m_data.data(); }
	UINT size() const { return static_cast<UINT>(m_data.size()); }
	DWORD fvf() const { return m_fvf; }
	GpuBufferMirror &mirror() { return m_mirror; }

private:
	GpuBufferMirror m_mirror;
	ULONG m_refs = 1;
	WebGPUD3DDevice *m_device;
	std::vector<uint8_t> m_data;
	DWORD m_usage;
	DWORD m_fvf;
	D3DPOOL m_pool;
	DWORD m_priority = 0;
};

class WebGPUIndexBuffer final : public IDirect3DIndexBuffer8
{
public:
	WebGPUIndexBuffer(WebGPUD3DDevice *device, UINT length, DWORD usage, D3DFORMAT format, D3DPOOL pool);
	~WebGPUIndexBuffer();

	HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, void **output) override;
	ULONG STDMETHODCALLTYPE AddRef() override;
	ULONG STDMETHODCALLTYPE Release() override;
	HRESULT STDMETHODCALLTYPE GetDevice(IDirect3DDevice8 **device) override;
	HRESULT STDMETHODCALLTYPE SetPrivateData(REFGUID, const void *, DWORD, DWORD) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE GetPrivateData(REFGUID, void *, DWORD *) override { return D3DERR_NOTFOUND; }
	HRESULT STDMETHODCALLTYPE FreePrivateData(REFGUID) override { return D3DERR_NOTFOUND; }
	DWORD STDMETHODCALLTYPE SetPriority(DWORD priority) override { return std::exchange(m_priority, priority); }
	DWORD STDMETHODCALLTYPE GetPriority() override { return m_priority; }
	void STDMETHODCALLTYPE PreLoad() override {}
	D3DRESOURCETYPE STDMETHODCALLTYPE GetType() override { return D3DRTYPE_INDEXBUFFER; }
	HRESULT STDMETHODCALLTYPE Lock(UINT offset, UINT size, BYTE **data, DWORD flags) override;
	HRESULT STDMETHODCALLTYPE Unlock() override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE GetDesc(D3DINDEXBUFFER_DESC *desc) override;

	const uint8_t *data() const { return m_data.data(); }
	UINT size() const { return static_cast<UINT>(m_data.size()); }
	D3DFORMAT format() const { return m_format; }
	GpuBufferMirror &mirror() { return m_mirror; }

private:
	GpuBufferMirror m_mirror;
	ULONG m_refs = 1;
	WebGPUD3DDevice *m_device;
	std::vector<uint8_t> m_data;
	DWORD m_usage;
	D3DFORMAT m_format;
	D3DPOOL m_pool;
	DWORD m_priority = 0;
};

struct TextureLevel
{
	UINT width = 0;
	UINT height = 0;
	UINT pitch = 0;
	std::vector<uint8_t> data;
};

class WebGPUSurface final : public IDirect3DSurface8
{
public:
	WebGPUSurface(WebGPUD3DDevice *device, UINT width, UINT height, D3DFORMAT format, DWORD usage, D3DPOOL pool, bool retainDevice = true);
	WebGPUSurface(WebGPUTexture *texture, UINT level);
	~WebGPUSurface();

	HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, void **output) override;
	ULONG STDMETHODCALLTYPE AddRef() override;
	ULONG STDMETHODCALLTYPE Release() override;
	HRESULT STDMETHODCALLTYPE GetDevice(IDirect3DDevice8 **device) override;
	HRESULT STDMETHODCALLTYPE SetPrivateData(REFGUID, const void *, DWORD, DWORD) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE GetPrivateData(REFGUID, void *, DWORD *) override { return D3DERR_NOTFOUND; }
	HRESULT STDMETHODCALLTYPE FreePrivateData(REFGUID) override { return D3DERR_NOTFOUND; }
	HRESULT STDMETHODCALLTYPE GetContainer(REFIID, void **container) override;
	HRESULT STDMETHODCALLTYPE GetDesc(D3DSURFACE_DESC *desc) override;
	HRESULT STDMETHODCALLTYPE LockRect(D3DLOCKED_RECT *lockedRect, const RECT *rect, DWORD flags) override;
	HRESULT STDMETHODCALLTYPE UnlockRect() override;

	TextureLevel &level();
	const TextureLevel &level() const;
	D3DFORMAT format() const { return m_format; }
	UINT width() const { return level().width; }
	UINT height() const { return level().height; }
	// GeneralsX @bugfix zhwp 17/10/2026 Tell a real depth-stencil surface apart from a colour render target.
	bool isDepthSurface() const;
	WGPUTextureView renderView();
	void markDirty();

private:
	ULONG m_refs = 1;
	WebGPUD3DDevice *m_device = nullptr;
	WebGPUTexture *m_texture = nullptr;
	UINT m_level = 0;
	D3DFORMAT m_format;
	DWORD m_usage;
	D3DPOOL m_pool;
	TextureLevel m_storage;
	bool m_retainsDevice = true;
	WGPUTexture m_gpuTexture = nullptr;
	WGPUTextureView m_gpuView = nullptr;
};

class WebGPUTexture final : public IDirect3DTexture8
{
public:
	WebGPUTexture(WebGPUD3DDevice *device, UINT width, UINT height, UINT levels, DWORD usage, D3DFORMAT format, D3DPOOL pool);
	~WebGPUTexture();

	HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, void **output) override;
	ULONG STDMETHODCALLTYPE AddRef() override;
	ULONG STDMETHODCALLTYPE Release() override;
	HRESULT STDMETHODCALLTYPE GetDevice(IDirect3DDevice8 **device) override;
	HRESULT STDMETHODCALLTYPE SetPrivateData(REFGUID, const void *, DWORD, DWORD) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE GetPrivateData(REFGUID, void *, DWORD *) override { return D3DERR_NOTFOUND; }
	HRESULT STDMETHODCALLTYPE FreePrivateData(REFGUID) override { return D3DERR_NOTFOUND; }
	DWORD STDMETHODCALLTYPE SetPriority(DWORD priority) override { return std::exchange(m_priority, priority); }
	DWORD STDMETHODCALLTYPE GetPriority() override { return m_priority; }
	void STDMETHODCALLTYPE PreLoad() override;
	D3DRESOURCETYPE STDMETHODCALLTYPE GetType() override { return D3DRTYPE_TEXTURE; }
	DWORD STDMETHODCALLTYPE SetLOD(DWORD lod) override { return std::exchange(m_lod, lod); }
	DWORD STDMETHODCALLTYPE GetLOD() override { return m_lod; }
	DWORD STDMETHODCALLTYPE GetLevelCount() override { return static_cast<DWORD>(m_levels.size()); }
	HRESULT STDMETHODCALLTYPE GetLevelDesc(UINT level, D3DSURFACE_DESC *desc) override;
	HRESULT STDMETHODCALLTYPE GetSurfaceLevel(UINT level, IDirect3DSurface8 **surface) override;
	HRESULT STDMETHODCALLTYPE LockRect(UINT level, D3DLOCKED_RECT *lockedRect, const RECT *rect, DWORD flags) override;
	HRESULT STDMETHODCALLTYPE UnlockRect(UINT level) override;
	HRESULT STDMETHODCALLTYPE AddDirtyRect(const RECT *) override { m_dirty = true; return D3D_OK; }

	TextureLevel &level(UINT index) { return m_levels[index]; }
	const TextureLevel &level(UINT index) const { return m_levels[index]; }
	D3DFORMAT format() const { return m_format; }
	// GeneralsX @bugfix zhwp 17/10/2026 Let surfaces inherit the depth-stencil usage of their texture.
	DWORD usage() const { return m_usage; }
	WGPUTextureView view();
	WGPUTextureView createRenderView(UINT level);
	void copyFrom(const WebGPUTexture &source);
	void markDirty() { m_dirty = true; }

private:
	bool upload();

	ULONG m_refs = 1;
	WebGPUD3DDevice *m_device;
	std::vector<TextureLevel> m_levels;
	DWORD m_usage;
	D3DFORMAT m_format;
	D3DPOOL m_pool;
	DWORD m_priority = 0;
	DWORD m_lod = 0;
	bool m_dirty = true;
	WGPUTexture m_texture = nullptr;
	WGPUTextureView m_view = nullptr;
};

class WebGPUDirect3D8;
class WebGPUD3DDevice;

WebGPUD3DDevice *g_activeWebGPUDevice = nullptr;

class WebGPUD3DDevice final : public IDirect3DDevice8
{
public:
	WebGPUD3DDevice(WebGPUDirect3D8 *parent, WebGPUContext *context, const D3DPRESENT_PARAMETERS &parameters);
	~WebGPUD3DDevice();
	bool initialize();
	bool canSubmitFrame() const { return !m_uploadFrames[m_nextUploadFrame].busy; }

	HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, void **output) override;
	ULONG STDMETHODCALLTYPE AddRef() override;
	ULONG STDMETHODCALLTYPE Release() override;
	HRESULT STDMETHODCALLTYPE TestCooperativeLevel() override { return D3D_OK; }
	UINT STDMETHODCALLTYPE GetAvailableTextureMem() override { return 256U * 1024U * 1024U; }
	HRESULT STDMETHODCALLTYPE ResourceManagerDiscardBytes(DWORD) override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE GetDirect3D(IDirect3D8 **direct3D) override;
	HRESULT STDMETHODCALLTYPE GetDeviceCaps(D3DCAPS8 *caps) override;
	HRESULT STDMETHODCALLTYPE GetDisplayMode(D3DDISPLAYMODE *mode) override;
	HRESULT STDMETHODCALLTYPE GetCreationParameters(D3DDEVICE_CREATION_PARAMETERS *parameters) override;
	HRESULT STDMETHODCALLTYPE SetCursorProperties(UINT, UINT, IDirect3DSurface8 *) override { return D3D_OK; }
	void STDMETHODCALLTYPE SetCursorPosition(UINT, UINT, DWORD) override {}
	WINBOOL STDMETHODCALLTYPE ShowCursor(WINBOOL show) override { return show; }
	HRESULT STDMETHODCALLTYPE CreateAdditionalSwapChain(D3DPRESENT_PARAMETERS *, IDirect3DSwapChain8 **) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE Reset(D3DPRESENT_PARAMETERS *parameters) override;
	HRESULT STDMETHODCALLTYPE Present(const RECT *, const RECT *, HWND, const RGNDATA *) override;
	HRESULT STDMETHODCALLTYPE GetBackBuffer(UINT, D3DBACKBUFFER_TYPE, IDirect3DSurface8 **surface) override;
	HRESULT STDMETHODCALLTYPE GetRasterStatus(D3DRASTER_STATUS *status) override;
	void STDMETHODCALLTYPE SetGammaRamp(DWORD, const D3DGAMMARAMP *) override {}
	void STDMETHODCALLTYPE GetGammaRamp(D3DGAMMARAMP *ramp) override;
	HRESULT STDMETHODCALLTYPE CreateTexture(UINT width, UINT height, UINT levels, DWORD usage, D3DFORMAT format, D3DPOOL pool, IDirect3DTexture8 **texture) override;
	HRESULT STDMETHODCALLTYPE CreateVolumeTexture(UINT, UINT, UINT, UINT, DWORD, D3DFORMAT, D3DPOOL, IDirect3DVolumeTexture8 **) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE CreateCubeTexture(UINT, UINT, DWORD, D3DFORMAT, D3DPOOL, IDirect3DCubeTexture8 **) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE CreateVertexBuffer(UINT length, DWORD usage, DWORD fvf, D3DPOOL pool, IDirect3DVertexBuffer8 **buffer) override;
	HRESULT STDMETHODCALLTYPE CreateIndexBuffer(UINT length, DWORD usage, D3DFORMAT format, D3DPOOL pool, IDirect3DIndexBuffer8 **buffer) override;
	HRESULT STDMETHODCALLTYPE CreateRenderTarget(UINT width, UINT height, D3DFORMAT format, D3DMULTISAMPLE_TYPE, WINBOOL, IDirect3DSurface8 **surface) override;
	HRESULT STDMETHODCALLTYPE CreateDepthStencilSurface(UINT width, UINT height, D3DFORMAT format, D3DMULTISAMPLE_TYPE, IDirect3DSurface8 **surface) override;
	HRESULT STDMETHODCALLTYPE CreateImageSurface(UINT width, UINT height, D3DFORMAT format, IDirect3DSurface8 **surface) override;
	HRESULT STDMETHODCALLTYPE CopyRects(IDirect3DSurface8 *source, const RECT *sourceRects, UINT rectCount, IDirect3DSurface8 *destination, const POINT *destinationPoints) override;
	HRESULT STDMETHODCALLTYPE UpdateTexture(IDirect3DBaseTexture8 *source, IDirect3DBaseTexture8 *destination) override;
	HRESULT STDMETHODCALLTYPE GetFrontBuffer(IDirect3DSurface8 *) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE SetRenderTarget(IDirect3DSurface8 *renderTarget, IDirect3DSurface8 *depthStencil) override;
	HRESULT STDMETHODCALLTYPE GetRenderTarget(IDirect3DSurface8 **renderTarget) override;
	HRESULT STDMETHODCALLTYPE GetDepthStencilSurface(IDirect3DSurface8 **depthStencil) override;
	HRESULT STDMETHODCALLTYPE BeginScene() override { return ensurePass(0, 0, 1.0f, 0); }
	HRESULT STDMETHODCALLTYPE EndScene() override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE Clear(DWORD, const D3DRECT *, DWORD flags, D3DCOLOR color, float z, DWORD stencil) override;
	HRESULT STDMETHODCALLTYPE SetTransform(D3DTRANSFORMSTATETYPE state, const D3DMATRIX *matrix) override;
	HRESULT STDMETHODCALLTYPE GetTransform(D3DTRANSFORMSTATETYPE state, D3DMATRIX *matrix) override;
	HRESULT STDMETHODCALLTYPE MultiplyTransform(D3DTRANSFORMSTATETYPE state, const D3DMATRIX *matrix) override;
	HRESULT STDMETHODCALLTYPE SetViewport(const D3DVIEWPORT8 *viewport) override;
	HRESULT STDMETHODCALLTYPE GetViewport(D3DVIEWPORT8 *viewport) override;
	HRESULT STDMETHODCALLTYPE SetMaterial(const D3DMATERIAL8 *material) override;
	HRESULT STDMETHODCALLTYPE GetMaterial(D3DMATERIAL8 *material) override;
	HRESULT STDMETHODCALLTYPE SetLight(DWORD index, const D3DLIGHT8 *light) override;
	HRESULT STDMETHODCALLTYPE GetLight(DWORD index, D3DLIGHT8 *light) override;
	HRESULT STDMETHODCALLTYPE LightEnable(DWORD index, WINBOOL enable) override;
	HRESULT STDMETHODCALLTYPE GetLightEnable(DWORD index, WINBOOL *enable) override;
	HRESULT STDMETHODCALLTYPE SetClipPlane(DWORD, const float *) override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE GetClipPlane(DWORD, float *) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE SetRenderState(D3DRENDERSTATETYPE state, DWORD value) override;
	HRESULT STDMETHODCALLTYPE GetRenderState(D3DRENDERSTATETYPE state, DWORD *value) override;
	HRESULT STDMETHODCALLTYPE BeginStateBlock() override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE EndStateBlock(DWORD *token) override { if (token) *token = 1; return token ? D3D_OK : D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE ApplyStateBlock(DWORD) override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE CaptureStateBlock(DWORD) override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE DeleteStateBlock(DWORD) override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE CreateStateBlock(D3DSTATEBLOCKTYPE, DWORD *token) override { if (token) *token = 1; return token ? D3D_OK : D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE SetClipStatus(const D3DCLIPSTATUS8 *) override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE GetClipStatus(D3DCLIPSTATUS8 *) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE GetTexture(DWORD stage, IDirect3DBaseTexture8 **texture) override;
	HRESULT STDMETHODCALLTYPE SetTexture(DWORD stage, IDirect3DBaseTexture8 *texture) override;
	HRESULT STDMETHODCALLTYPE GetTextureStageState(DWORD stage, D3DTEXTURESTAGESTATETYPE type, DWORD *value) override;
	HRESULT STDMETHODCALLTYPE SetTextureStageState(DWORD stage, D3DTEXTURESTAGESTATETYPE type, DWORD value) override;
	HRESULT STDMETHODCALLTYPE ValidateDevice(DWORD *passes) override { if (passes) *passes = 1; return passes ? D3D_OK : D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE GetInfo(DWORD, void *, DWORD) override { return S_FALSE; }
	HRESULT STDMETHODCALLTYPE SetPaletteEntries(UINT, const PALETTEENTRY *) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE GetPaletteEntries(UINT, PALETTEENTRY *) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE SetCurrentTexturePalette(UINT) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE GetCurrentTexturePalette(UINT *) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE DrawPrimitive(D3DPRIMITIVETYPE type, UINT startVertex, UINT primitiveCount) override;
	HRESULT STDMETHODCALLTYPE DrawIndexedPrimitive(D3DPRIMITIVETYPE type, UINT minIndex, UINT vertexCount, UINT startIndex, UINT primitiveCount) override;
	HRESULT STDMETHODCALLTYPE DrawPrimitiveUP(D3DPRIMITIVETYPE type, UINT primitiveCount, const void *data, UINT stride) override;
	HRESULT STDMETHODCALLTYPE DrawIndexedPrimitiveUP(D3DPRIMITIVETYPE type, UINT minVertexIndex, UINT vertexCount, UINT primitiveCount, const void *indexData, D3DFORMAT indexFormat, const void *data, UINT stride) override;
	HRESULT STDMETHODCALLTYPE ProcessVertices(UINT, UINT, UINT, IDirect3DVertexBuffer8 *, DWORD) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE CreateVertexShader(const DWORD *declaration, const DWORD *function, DWORD *handle, DWORD usage) override;
	HRESULT STDMETHODCALLTYPE SetVertexShader(DWORD handle) override;
	HRESULT STDMETHODCALLTYPE GetVertexShader(DWORD *handle) override { if (handle) *handle = m_vertexShader; return handle ? D3D_OK : D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE DeleteVertexShader(DWORD handle) override;
	HRESULT STDMETHODCALLTYPE SetVertexShaderConstant(DWORD startRegister, const void *data, DWORD count) override;
	HRESULT STDMETHODCALLTYPE GetVertexShaderConstant(DWORD startRegister, void *data, DWORD count) override;
	HRESULT STDMETHODCALLTYPE GetVertexShaderDeclaration(DWORD handle, void *data, DWORD *size) override;
	HRESULT STDMETHODCALLTYPE GetVertexShaderFunction(DWORD handle, void *data, DWORD *size) override;
	HRESULT STDMETHODCALLTYPE SetStreamSource(UINT stream, IDirect3DVertexBuffer8 *buffer, UINT stride) override;
	HRESULT STDMETHODCALLTYPE GetStreamSource(UINT stream, IDirect3DVertexBuffer8 **buffer, UINT *stride) override;
	HRESULT STDMETHODCALLTYPE SetIndices(IDirect3DIndexBuffer8 *indices, UINT baseVertexIndex) override;
	HRESULT STDMETHODCALLTYPE GetIndices(IDirect3DIndexBuffer8 **indices, UINT *baseVertexIndex) override;
	HRESULT STDMETHODCALLTYPE CreatePixelShader(const DWORD *function, DWORD *handle) override;
	HRESULT STDMETHODCALLTYPE SetPixelShader(DWORD handle) override;
	HRESULT STDMETHODCALLTYPE GetPixelShader(DWORD *handle) override { if (handle) *handle = m_pixelShader; return handle ? D3D_OK : D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE DeletePixelShader(DWORD handle) override;
	HRESULT STDMETHODCALLTYPE SetPixelShaderConstant(DWORD, const void *, DWORD) override { return D3D_OK; }
	HRESULT STDMETHODCALLTYPE GetPixelShaderConstant(DWORD, void *, DWORD) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE GetPixelShaderFunction(DWORD, void *, DWORD *) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE DrawRectPatch(UINT, const float *, const D3DRECTPATCH_INFO *) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE DrawTriPatch(UINT, const float *, const D3DTRIPATCH_INFO *) override { return D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE DeletePatch(UINT) override { return D3D_OK; }

	WGPUDevice webGPUDevice() const { return m_context->device(); }
	WGPUQueue webGPUQueue() const { return m_context->queue(); }

private:
	struct DrawBindings
	{
		WGPUBindGroup group = nullptr;
		uint32_t uniformOffset = 0;
	};

	struct UploadFrame
	{
		WGPUBuffer vertexBuffer = nullptr;
		WGPUBuffer indexBuffer = nullptr;
		WGPUBuffer uniformBuffer = nullptr;
		WGPUBuffer rawVertexBuffer = nullptr;
		WGPUBuffer fixedFunctionBuffer = nullptr;
		WGPUBindGroup fixedFunctionGroup = nullptr;
		std::vector<CanonicalVertex> vertices;
		std::vector<uint32_t> indices;
		std::vector<uint8_t> uniforms;
		std::vector<uint8_t> rawVertices;
		std::vector<uint8_t> fixedFunction;
		// What uniformBuffer holds from the frame's last use. The fixed-function
		// blocks shift offset between frames, so that buffer is written whole.
		std::vector<uint8_t> uniformShadow;
		size_t lastFixedFunctionOffset = SIZE_MAX;
		size_t lastFixedFunctionSize = 0;
		// Mirror buffers replaced while this frame's draws still read them;
		// released once the frame's commands are done.
		std::vector<RetiredBuffer> retiredBuffers;
		std::map<std::array<uintptr_t, 8>, WGPUBindGroup> bindGroups;
		bool busy = false;
	};

	friend class WebGPUDirect3D8;
	HRESULT ensurePass(DWORD clearFlags, D3DCOLOR color, float depth, DWORD stencil);
	void finishPass();
	void releaseFrame();
	bool prepareUploadFrame();
	void releaseUploadFrame(UploadFrame &frame);
	void createDepthBuffer();
	uint32_t renderSampleCount() const;
	WGPUTextureView swapChainDepthView() const;
	WGPURenderPipeline pipeline(D3DPRIMITIVETYPE type, const VertexSetup *fixedFunction = nullptr, UINT stride = 0);
	bool canUseFixedFunctionShader(const VertexSetup &setup, UINT stride) const;
	WGPUShaderModule vertexShaderModule(const VertexShaderProgram &program);
	bool canUseVertexShaderProgram(const VertexSetup &setup, UINT stride);
	bool vertexShaderUniforms(uint32_t &offset);
	bool appendGroup1Block(const void *block, size_t size, uint32_t &offset);
	void updateFixedFunctionChoice();
	WGPUBuffer syncMirror(GpuBufferMirror &mirror, const uint8_t *data, size_t size, WGPUBufferUsage usage, size_t useBegin, size_t useEnd);
	void writeMirror(GpuBufferMirror &mirror);
	void writeMirrorRange(GpuBufferMirror &mirror, size_t begin, size_t end);
	static bool sameBytes(const uint8_t *shadow, const uint8_t *source, size_t size, size_t begin, size_t end);
	template <typename Write>
	static void forEachChangedRun(const uint8_t *shadow, const uint8_t *source, size_t size, size_t begin, size_t end, Write write);
	void writeUpload(WGPUBuffer buffer, const uint8_t *bytes, size_t size, std::vector<uint8_t> &shadow);
	void flushMirrors();
public:
	void flushMirror(GpuBufferMirror &mirror);
private:
	HRESULT encodeFixedFunctionDraw(D3DPRIMITIVETYPE type, const VertexSetup &setup, UINT stride,
		WGPUBuffer vertexBuffer, uint64_t vertexOffset, uint64_t vertexBytes,
		WGPUBuffer indexBuffer, WGPUIndexFormat indexFormat, uint64_t indexOffset, uint64_t indexBytes,
		uint32_t count, uint32_t firstIndex, int32_t baseVertex, uint32_t firstVertex, uint32_t fixedFunctionOffset);
	HRESULT drawFromMirrors(D3DPRIMITIVETYPE type, UINT count, UINT first, bool indexed, UINT minIndex = 0, UINT vertexCount = 0);
	bool fixedFunctionUniforms(const VertexSetup &setup, uint32_t &offset);
	DrawBindings bindGroup();
public:
	void forgetTextureView(WGPUTextureView view);
private:
	WGPUSampler sampler(UINT stage);
	WGPUTextureFormat colorTargetFormat() const;
	bool hasDepthTarget() const;
	HRESULT draw(D3DPRIMITIVETYPE type, const void *vertexData, UINT vertexCount, UINT stride, const void *indexData, D3DFORMAT indexFormat, UINT indexCount, UINT baseVertex);
	void prepareVertexSetup(VertexSetup &setup) const;
	CanonicalVertex convertVertex(const uint8_t *source, UINT stride, const VertexSetup &setup) const;
	CanonicalVertex convertVertexChecked(const uint8_t *source, UINT stride, const VertexSetup &setup) const;
#ifdef ZHWP_VERIFY_VERTEX
	CanonicalVertex convertVertexReference(const uint8_t *source, UINT stride) const;
#endif
	CanonicalVertex executeVertexShader(const VertexShaderProgram &program, const uint8_t *source, UINT stride) const;
	UINT vertexCountFor(D3DPRIMITIVETYPE type, UINT primitiveCount) const;
	WGPUBlendFactor blendFactor(DWORD factor) const;
	WGPUCompareFunction compareFunction(DWORD function) const;
	WGPUStencilOperation stencilOperation(DWORD operation) const;
	D3DMATRIX identityMatrix() const;
	static void onSubmittedWorkDone(WGPUQueueWorkDoneStatus status, WGPUStringView message, void *userdata1, void *userdata2);

	ULONG m_refs = 1;
	WebGPUDirect3D8 *m_parent;
	WebGPUContext *m_context;
	D3DPRESENT_PARAMETERS m_parameters;
	D3DDEVICE_CREATION_PARAMETERS m_creation = {};
	D3DVIEWPORT8 m_viewport = {};
	D3DMATERIAL8 m_material = {};
	std::unordered_map<DWORD, D3DMATRIX> m_transforms;
	std::unordered_map<DWORD, D3DLIGHT8> m_lights;
	std::unordered_map<DWORD, WINBOOL> m_lightEnabled;
	std::array<DWORD, 256> m_renderStates = {};
	std::array<std::array<DWORD, kTextureStateCount>, kTextureStageCount> m_textureStates = {};
	std::array<WebGPUTexture *, kTextureStageCount> m_textures = {};
	WebGPUVertexBuffer *m_vertexBuffer = nullptr;
	WebGPUIndexBuffer *m_indexBuffer = nullptr;
	UINT m_vertexStride = 0;
	UINT m_baseVertex = 0;
	DWORD m_vertexShader = D3DFVF_XYZ;
	DWORD m_nextVertexShader = 1;
	std::unordered_map<DWORD, VertexShaderProgram> m_vertexShaders;
	// vertex_vs modules translated from m_vertexShaders, by handle; null when
	// a program cannot run on the GPU and stays on executeVertexShader.
	std::unordered_map<DWORD, WGPUShaderModule> m_vertexShaderModules;
	std::array<std::array<float, 4>, 96> m_vertexShaderConstants = {};
	DWORD m_pixelShader = 0;
	DWORD m_nextPixelShader = 1;
	std::unordered_map<DWORD, PixelShaderProgram> m_pixelShaders;
	WebGPUSurface *m_backBuffer = nullptr;
	WebGPUSurface *m_depthSurface = nullptr;
	WebGPUSurface *m_renderTarget = nullptr;
	WebGPUSurface *m_depthTarget = nullptr;
	WGPUShaderModule m_shader = nullptr;
	WGPUBindGroupLayout m_bindGroupLayout = nullptr;
	WGPUPipelineLayout m_pipelineLayout = nullptr;
	// GPU fixed-function transform and lighting (vertex_ff): group 1 holds the
	// per-draw FixedFunctionUniforms, vertex slot 1 a zero buffer that feeds the
	// attributes the vertex format lacks.
	WGPUBindGroupLayout m_fixedFunctionGroupLayout = nullptr;
	WGPUPipelineLayout m_fixedFunctionPipelineLayout = nullptr;
	WGPUBuffer m_defaultAttributes = nullptr;
	std::map<std::pair<uint64_t, uint64_t>, WGPURenderPipeline> m_fixedFunctionPipelines;
	bool m_gpuFixedFunctionReady = false;
	bool m_gpuFixedFunction = false;
	bool m_fixedFunctionChoiceLogged = false;
	uint64_t m_frameSerial = 0;
	std::vector<GpuBufferMirror *> m_pendingMirrors;
	// Retired mirror buffers whose frame finished, kept for the next rename:
	// creating a buffer of a megabyte or more twice a frame used up the GPU's
	// memory faster than the browser freed the old ones, and the GPU process
	// died (white canvas on an Adreno phone, 2026-10-22).
	std::vector<RetiredBuffer> m_bufferPool;
	std::unordered_map<uint64_t, WGPUSampler> m_samplers;
	WGPUTexture m_whiteTexture = nullptr;
	WGPUTextureView m_whiteView = nullptr;
	WGPUTexture m_depthTexture = nullptr;
	WGPUTextureView m_depthView = nullptr;
	// GeneralsX @bugfix zhwp 19/10/2026 Single-sampled twin of the swap-chain depth for passes that render the scene into a texture while MSAA is on.
	WGPUTexture m_depthTextureSingle = nullptr;
	WGPUTextureView m_depthViewSingle = nullptr;
	WGPUTexture m_multisampleTexture = nullptr;
	WGPUTextureView m_multisampleView = nullptr;
	std::unordered_map<uint64_t, WGPURenderPipeline> m_pipelines;
	WGPUSurfaceTexture m_surfaceTexture = WGPU_SURFACE_TEXTURE_INIT;
	WGPUTextureView m_surfaceView = nullptr;
	WGPUCommandEncoder m_encoder = nullptr;
	WGPURenderPassEncoder m_pass = nullptr;
	// What the current pass already has bound, so draws skip calls that would
	// set the same state again (each WebGPU call from wasm is costly).
	struct PassState
	{
		WGPURenderPipeline pipeline = nullptr;
		uint32_t stencilReference = UINT32_MAX;
		std::array<WGPUBindGroup, 2> groups = {};
		std::array<uint32_t, 2> groupOffsets = {};
		std::array<WGPUBuffer, 2> vertexBuffers = {};
		std::array<uint64_t, 2> vertexOffsets = {};
		std::array<uint64_t, 2> vertexSizes = {};
		WGPUBuffer indexBuffer = nullptr;
		WGPUIndexFormat indexFormat = WGPUIndexFormat_Undefined;
		uint64_t indexOffset = 0;
		uint64_t indexSize = 0;
	};
	PassState m_passState;
	void bindPipeline(WGPURenderPipeline pipeline, uint32_t stencilReference);
	void bindGroupAt(uint32_t index, WGPUBindGroup group, uint32_t offset);
	void bindVertexBuffer(uint32_t slot, WGPUBuffer buffer, uint64_t offset, uint64_t size);
	void bindIndexBuffer(WGPUBuffer buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size);
	bool m_frameLoaded = false;
	std::array<UploadFrame, kUploadFrameCount> m_uploadFrames;
	size_t m_activeUploadFrame = 0;
	size_t m_nextUploadFrame = 0;
	// Indexed draws often name a vertex range much larger than what their
	// indices touch (W3D shares big vertex buffers). draw() converts only the
	// referenced vertices; these map a source vertex to its slot in the upload
	// frame for the current draw. An entry is valid when its stamp matches
	// m_remapGeneration, so nothing has to be cleared between draws.
	std::vector<uint32_t> m_remapSlot;
	std::vector<uint32_t> m_remapStamp;
	uint32_t m_remapGeneration = 0;
	unsigned int m_pendingSubmissions = 0;
};

class WebGPUDirect3D8 final : public IDirect3D8
{
public:
	WebGPUDirect3D8() = default;
	~WebGPUDirect3D8() = default;
	bool initialize();

	HRESULT STDMETHODCALLTYPE QueryInterface(REFIID, void **output) override;
	ULONG STDMETHODCALLTYPE AddRef() override { return ++m_refs; }
	ULONG STDMETHODCALLTYPE Release() override;
	HRESULT STDMETHODCALLTYPE RegisterSoftwareDevice(void *) override { return D3DERR_INVALIDCALL; }
	UINT STDMETHODCALLTYPE GetAdapterCount() override { return 1; }
	HRESULT STDMETHODCALLTYPE GetAdapterIdentifier(UINT adapter, DWORD, D3DADAPTER_IDENTIFIER8 *identifier) override;
	UINT STDMETHODCALLTYPE GetAdapterModeCount(UINT adapter) override { return adapter == 0 ? 6 : 0; }
	HRESULT STDMETHODCALLTYPE EnumAdapterModes(UINT adapter, UINT mode, D3DDISPLAYMODE *displayMode) override;
	HRESULT STDMETHODCALLTYPE GetAdapterDisplayMode(UINT adapter, D3DDISPLAYMODE *displayMode) override;
	HRESULT STDMETHODCALLTYPE CheckDeviceType(UINT adapter, D3DDEVTYPE, D3DFORMAT, D3DFORMAT, WINBOOL) override { return adapter == 0 ? D3D_OK : D3DERR_INVALIDCALL; }
	HRESULT STDMETHODCALLTYPE CheckDeviceFormat(UINT adapter, D3DDEVTYPE, D3DFORMAT, DWORD usage, D3DRESOURCETYPE type, D3DFORMAT format) override;
	HRESULT STDMETHODCALLTYPE CheckDeviceMultiSampleType(UINT, D3DDEVTYPE, D3DFORMAT, WINBOOL, D3DMULTISAMPLE_TYPE type) override { return type == D3DMULTISAMPLE_NONE || type == D3DMULTISAMPLE_4_SAMPLES ? D3D_OK : D3DERR_NOTAVAILABLE; }
	HRESULT STDMETHODCALLTYPE CheckDepthStencilMatch(UINT adapter, D3DDEVTYPE, D3DFORMAT, D3DFORMAT, D3DFORMAT depthFormat) override;
	HRESULT STDMETHODCALLTYPE GetDeviceCaps(UINT adapter, D3DDEVTYPE type, D3DCAPS8 *caps) override;
	HMONITOR STDMETHODCALLTYPE GetAdapterMonitor(UINT) override { return nullptr; }
	HRESULT STDMETHODCALLTYPE CreateDevice(UINT adapter, D3DDEVTYPE type, HWND window, DWORD behavior, D3DPRESENT_PARAMETERS *parameters, IDirect3DDevice8 **device) override;

	WebGPUContext &context() { return m_context; }

private:
	ULONG m_refs = 1;
	WebGPUContext m_context;
};

} // namespace

namespace
{
void WebGPUD3DDevice::createDepthBuffer()
{
	if (m_multisampleView) {
		wgpuTextureViewRelease(m_multisampleView);
		m_multisampleView = nullptr;
	}
	if (m_multisampleTexture) {
		wgpuTextureRelease(m_multisampleTexture);
		m_multisampleTexture = nullptr;
	}
	if (m_depthView) {
		wgpuTextureViewRelease(m_depthView);
		m_depthView = nullptr;
	}
	if (m_depthTexture) {
		wgpuTextureRelease(m_depthTexture);
		m_depthTexture = nullptr;
	}
	if (m_depthViewSingle) {
		wgpuTextureViewRelease(m_depthViewSingle);
		m_depthViewSingle = nullptr;
	}
	if (m_depthTextureSingle) {
		wgpuTextureRelease(m_depthTextureSingle);
		m_depthTextureSingle = nullptr;
	}
	const uint32_t sampleCount = m_parameters.MultiSampleType == D3DMULTISAMPLE_4_SAMPLES ? 4 : 1;
	if (sampleCount > 1) {
		WGPUTextureDescriptor colorDescriptor = WGPU_TEXTURE_DESCRIPTOR_INIT;
		colorDescriptor.usage = WGPUTextureUsage_RenderAttachment;
		colorDescriptor.dimension = WGPUTextureDimension_2D;
		colorDescriptor.size = { m_parameters.BackBufferWidth, m_parameters.BackBufferHeight, 1 };
		colorDescriptor.format = m_context->surfaceFormat();
		colorDescriptor.sampleCount = sampleCount;
		m_multisampleTexture = wgpuDeviceCreateTexture(webGPUDevice(), &colorDescriptor);
		m_multisampleView = m_multisampleTexture ? wgpuTextureCreateView(m_multisampleTexture, nullptr) : nullptr;
	}
	WGPUTextureDescriptor descriptor = WGPU_TEXTURE_DESCRIPTOR_INIT;
	descriptor.usage = WGPUTextureUsage_RenderAttachment;
	descriptor.dimension = WGPUTextureDimension_2D;
	descriptor.size = { m_parameters.BackBufferWidth, m_parameters.BackBufferHeight, 1 };
	descriptor.format = WGPUTextureFormat_Depth24PlusStencil8;
	descriptor.sampleCount = sampleCount;
	m_depthTexture = wgpuDeviceCreateTexture(webGPUDevice(), &descriptor);
	m_depthView = m_depthTexture ? wgpuTextureCreateView(m_depthTexture, nullptr) : nullptr;
	if (sampleCount > 1) {
		descriptor.sampleCount = 1;
		m_depthTextureSingle = wgpuDeviceCreateTexture(webGPUDevice(), &descriptor);
		m_depthViewSingle = m_depthTextureSingle ? wgpuTextureCreateView(m_depthTextureSingle, nullptr) : nullptr;
	}
}

uint32_t WebGPUD3DDevice::renderSampleCount() const
{
	const bool customColorTarget = m_renderTarget && m_renderTarget != m_backBuffer;
	return !customColorTarget && m_parameters.MultiSampleType == D3DMULTISAMPLE_4_SAMPLES ? 4 : 1;
}

HRESULT WebGPUD3DDevice::ensurePass(DWORD clearFlags, D3DCOLOR color, float depth, DWORD stencil)
{
	if (clearFlags != 0 && m_pass) {
		finishPass();
	}
	if (!m_surfaceTexture.texture) {
		if (!prepareUploadFrame()) {
			return D3DERR_DEVICELOST;
		}
		m_surfaceTexture = WGPU_SURFACE_TEXTURE_INIT;
		wgpuSurfaceGetCurrentTexture(m_context->surface(), &m_surfaceTexture);
		if (m_surfaceTexture.status != WGPUSurfaceGetCurrentTextureStatus_SuccessOptimal &&
			m_surfaceTexture.status != WGPUSurfaceGetCurrentTextureStatus_SuccessSuboptimal) {
			return D3DERR_DEVICELOST;
		}
		m_surfaceView = wgpuTextureCreateView(m_surfaceTexture.texture, nullptr);
		m_encoder = wgpuDeviceCreateCommandEncoder(webGPUDevice(), nullptr);
		m_frameLoaded = false;
	}
	if (m_pass) {
		return D3D_OK;
	}

	const bool customColorTarget = m_renderTarget && m_renderTarget != m_backBuffer;
	WGPUTextureView colorView = customColorTarget ? m_renderTarget->renderView() :
		(renderSampleCount() > 1 ? m_multisampleView : m_surfaceView);
	// GeneralsX @bugfix zhwp 17/10/2026 Only attach a real depth surface that has the colour target's size.
	const bool depthTarget = hasDepthTarget();
	WGPUTextureView depthView = nullptr;
	if (depthTarget) {
		depthView = m_depthTarget && m_depthTarget != m_depthSurface ? m_depthTarget->renderView() : swapChainDepthView();
	}
	if (!colorView || (depthTarget && !depthView)) {
		return D3DERR_DRIVERINTERNALERROR;
	}

	const bool mustClearColor = !m_frameLoaded || (clearFlags & D3DCLEAR_TARGET) != 0;
	const bool mustClearDepth = !m_frameLoaded || (clearFlags & D3DCLEAR_ZBUFFER) != 0;
	const bool mustClearStencil = !m_frameLoaded || (clearFlags & D3DCLEAR_STENCIL) != 0;
	WGPURenderPassColorAttachment colorAttachment = WGPU_RENDER_PASS_COLOR_ATTACHMENT_INIT;
	colorAttachment.view = colorView;
	colorAttachment.resolveTarget = !customColorTarget && renderSampleCount() > 1 ? m_surfaceView : nullptr;
	colorAttachment.loadOp = mustClearColor ? WGPULoadOp_Clear : WGPULoadOp_Load;
	colorAttachment.storeOp = WGPUStoreOp_Store;
	colorAttachment.clearValue = {
		static_cast<double>((color >> 16) & 0xff) / 255.0,
		static_cast<double>((color >> 8) & 0xff) / 255.0,
		static_cast<double>(color & 0xff) / 255.0,
		static_cast<double>((color >> 24) & 0xff) / 255.0,
	};
	WGPURenderPassDepthStencilAttachment depthAttachment = WGPU_RENDER_PASS_DEPTH_STENCIL_ATTACHMENT_INIT;
	depthAttachment.view = depthView;
	depthAttachment.depthLoadOp = mustClearDepth ? WGPULoadOp_Clear : WGPULoadOp_Load;
	depthAttachment.depthStoreOp = WGPUStoreOp_Store;
	depthAttachment.depthClearValue = depth;
	depthAttachment.depthReadOnly = WGPU_FALSE;
	depthAttachment.stencilLoadOp = mustClearStencil ? WGPULoadOp_Clear : WGPULoadOp_Load;
	depthAttachment.stencilStoreOp = WGPUStoreOp_Store;
	depthAttachment.stencilClearValue = stencil;
	WGPURenderPassDescriptor passDescriptor = WGPU_RENDER_PASS_DESCRIPTOR_INIT;
	passDescriptor.colorAttachmentCount = 1;
	passDescriptor.colorAttachments = &colorAttachment;
	passDescriptor.depthStencilAttachment = depthView ? &depthAttachment : nullptr;
	m_pass = wgpuCommandEncoderBeginRenderPass(m_encoder, &passDescriptor);
	m_passState = {};
	if (!m_pass) {
		return D3DERR_DRIVERINTERNALERROR;
	}
	wgpuRenderPassEncoderSetViewport(m_pass, static_cast<float>(m_viewport.X), static_cast<float>(m_viewport.Y), static_cast<float>(m_viewport.Width), static_cast<float>(m_viewport.Height), m_viewport.MinZ, m_viewport.MaxZ);
	m_frameLoaded = true;
	return D3D_OK;
}

void WebGPUD3DDevice::bindPipeline(WGPURenderPipeline pipeline, uint32_t stencilReference)
{
	if (m_passState.pipeline != pipeline) {
		wgpuRenderPassEncoderSetPipeline(m_pass, pipeline);
		m_passState.pipeline = pipeline;
	}
	if (m_passState.stencilReference != stencilReference) {
		wgpuRenderPassEncoderSetStencilReference(m_pass, stencilReference);
		m_passState.stencilReference = stencilReference;
	}
}

void WebGPUD3DDevice::bindGroupAt(uint32_t index, WGPUBindGroup group, uint32_t offset)
{
	if (m_passState.groups[index] == group && m_passState.groupOffsets[index] == offset) return;
	wgpuRenderPassEncoderSetBindGroup(m_pass, index, group, 1, &offset);
	m_passState.groups[index] = group;
	m_passState.groupOffsets[index] = offset;
}

void WebGPUD3DDevice::bindVertexBuffer(uint32_t slot, WGPUBuffer buffer, uint64_t offset, uint64_t size)
{
	if (m_passState.vertexBuffers[slot] == buffer && m_passState.vertexOffsets[slot] == offset && m_passState.vertexSizes[slot] == size) return;
	wgpuRenderPassEncoderSetVertexBuffer(m_pass, slot, buffer, offset, size);
	m_passState.vertexBuffers[slot] = buffer;
	m_passState.vertexOffsets[slot] = offset;
	m_passState.vertexSizes[slot] = size;
}

void WebGPUD3DDevice::bindIndexBuffer(WGPUBuffer buffer, WGPUIndexFormat format, uint64_t offset, uint64_t size)
{
	if (m_passState.indexBuffer == buffer && m_passState.indexFormat == format && m_passState.indexOffset == offset && m_passState.indexSize == size) return;
	wgpuRenderPassEncoderSetIndexBuffer(m_pass, buffer, format, offset, size);
	m_passState.indexBuffer = buffer;
	m_passState.indexFormat = format;
	m_passState.indexOffset = offset;
	m_passState.indexSize = size;
}

void WebGPUD3DDevice::finishPass()
{
	if (!m_pass) {
		return;
	}
	wgpuRenderPassEncoderEnd(m_pass);
	wgpuRenderPassEncoderRelease(m_pass);
	m_pass = nullptr;
}

void WebGPUD3DDevice::releaseFrame()
{
	finishPass();
	if (m_encoder) {
		wgpuCommandEncoderRelease(m_encoder);
		m_encoder = nullptr;
	}
	if (m_surfaceView) {
		wgpuTextureViewRelease(m_surfaceView);
		m_surfaceView = nullptr;
	}
	if (m_surfaceTexture.texture) {
		wgpuTextureRelease(m_surfaceTexture.texture);
		m_surfaceTexture = WGPU_SURFACE_TEXTURE_INIT;
	}
	m_frameLoaded = false;
}

bool WebGPUD3DDevice::prepareUploadFrame()
{
	UploadFrame &frame = m_uploadFrames[m_nextUploadFrame];
	if (frame.busy) {
		return false;
	}
	// Bind groups stay cached across frames (forgetTextureView drops those of
	// a destroyed texture); the cap only bounds a pathological scene.
	if (frame.bindGroups.size() > kMaxCachedBindGroups) {
		for (const auto &[key, group] : frame.bindGroups) {
			(void)key;
			wgpuBindGroupRelease(group);
		}
		frame.bindGroups.clear();
	}
	// The GPU finished the frame. A bare release leaves a buffer's memory to the
	// browser's garbage collector, so what the pool cannot take is destroyed.
	for (const RetiredBuffer &retired : frame.retiredBuffers) {
		if (m_bufferPool.size() < kMaxPooledBuffers) {
			m_bufferPool.push_back(retired);
		} else {
			wgpuBufferDestroy(retired.buffer);
			wgpuBufferRelease(retired.buffer);
		}
	}
	frame.retiredBuffers.clear();
	frame.vertices.clear();
	frame.indices.clear();
	frame.uniforms.clear();
	frame.rawVertices.clear();
	frame.fixedFunction.clear();
	frame.lastFixedFunctionOffset = SIZE_MAX;
	m_activeUploadFrame = m_nextUploadFrame;
	return true;
}

void WebGPUD3DDevice::releaseUploadFrame(UploadFrame &frame)
{
	for (const auto &[key, group] : frame.bindGroups) {
		(void)key;
		wgpuBindGroupRelease(group);
	}
	frame.bindGroups.clear();
	for (const RetiredBuffer &retired : frame.retiredBuffers) wgpuBufferRelease(retired.buffer);
	frame.retiredBuffers.clear();
	if (frame.indexBuffer) {
		wgpuBufferRelease(frame.indexBuffer);
		frame.indexBuffer = nullptr;
	}
	std::vector<uint8_t>().swap(frame.uniformShadow);
	if (frame.uniformBuffer) {
		wgpuBufferRelease(frame.uniformBuffer);
		frame.uniformBuffer = nullptr;
	}
	if (frame.fixedFunctionGroup) {
		wgpuBindGroupRelease(frame.fixedFunctionGroup);
		frame.fixedFunctionGroup = nullptr;
	}
	if (frame.fixedFunctionBuffer) {
		wgpuBufferRelease(frame.fixedFunctionBuffer);
		frame.fixedFunctionBuffer = nullptr;
	}
	if (frame.rawVertexBuffer) {
		wgpuBufferRelease(frame.rawVertexBuffer);
		frame.rawVertexBuffer = nullptr;
	}
	if (frame.vertexBuffer) {
		wgpuBufferRelease(frame.vertexBuffer);
		frame.vertexBuffer = nullptr;
	}
}

WGPUBlendFactor WebGPUD3DDevice::blendFactor(DWORD factor) const
{
	switch (factor) {
		case D3DBLEND_ZERO: return WGPUBlendFactor_Zero;
		case D3DBLEND_ONE: return WGPUBlendFactor_One;
		case D3DBLEND_SRCCOLOR: return WGPUBlendFactor_Src;
		case D3DBLEND_INVSRCCOLOR: return WGPUBlendFactor_OneMinusSrc;
		case D3DBLEND_SRCALPHA: return WGPUBlendFactor_SrcAlpha;
		case D3DBLEND_INVSRCALPHA: return WGPUBlendFactor_OneMinusSrcAlpha;
		case D3DBLEND_DESTALPHA: return WGPUBlendFactor_DstAlpha;
		case D3DBLEND_INVDESTALPHA: return WGPUBlendFactor_OneMinusDstAlpha;
		case D3DBLEND_DESTCOLOR: return WGPUBlendFactor_Dst;
		case D3DBLEND_INVDESTCOLOR: return WGPUBlendFactor_OneMinusDst;
		default: return WGPUBlendFactor_One;
	}
}

WGPUCompareFunction WebGPUD3DDevice::compareFunction(DWORD function) const
{
	switch (function) {
		case D3DCMP_NEVER: return WGPUCompareFunction_Never;
		case D3DCMP_LESS: return WGPUCompareFunction_Less;
		case D3DCMP_EQUAL: return WGPUCompareFunction_Equal;
		case D3DCMP_LESSEQUAL: return WGPUCompareFunction_LessEqual;
		case D3DCMP_GREATER: return WGPUCompareFunction_Greater;
		case D3DCMP_NOTEQUAL: return WGPUCompareFunction_NotEqual;
		case D3DCMP_GREATEREQUAL: return WGPUCompareFunction_GreaterEqual;
		default: return WGPUCompareFunction_Always;
	}
}

WGPUStencilOperation WebGPUD3DDevice::stencilOperation(DWORD operation) const
{
	switch (operation) {
		case D3DSTENCILOP_ZERO: return WGPUStencilOperation_Zero;
		case D3DSTENCILOP_REPLACE: return WGPUStencilOperation_Replace;
		case D3DSTENCILOP_INCRSAT: return WGPUStencilOperation_IncrementClamp;
		case D3DSTENCILOP_DECRSAT: return WGPUStencilOperation_DecrementClamp;
		case D3DSTENCILOP_INVERT: return WGPUStencilOperation_Invert;
		case D3DSTENCILOP_INCR: return WGPUStencilOperation_IncrementWrap;
		case D3DSTENCILOP_DECR: return WGPUStencilOperation_DecrementWrap;
		default: return WGPUStencilOperation_Keep;
	}
}

WGPUTextureFormat WebGPUD3DDevice::colorTargetFormat() const
{
	return m_renderTarget && m_renderTarget != m_backBuffer ? WGPUTextureFormat_RGBA8Unorm : m_context->surfaceFormat();
}

bool WebGPUD3DDevice::hasDepthTarget() const
{
	// GeneralsX @bugfix zhwp 17/10/2026 The pipeline depth state must match the attachment ensurePass can provide.
	const bool customColorTarget = m_renderTarget && m_renderTarget != m_backBuffer;
	const UINT colorWidth = customColorTarget ? m_renderTarget->width() : m_parameters.BackBufferWidth;
	const UINT colorHeight = customColorTarget ? m_renderTarget->height() : m_parameters.BackBufferHeight;
	// GeneralsX @bugfix zhwp 19/10/2026 #184 Colour and depth attachments of a pass must share a sample count: the swap-chain depth is multisampled, every other depth texture is single-sampled.
	// A scene rendered into a texture with MSAA on uses the swap-chain depth's single-sampled twin (swapChainDepthView), so it keeps its depth test.
	const bool depthIsSwapChain = m_depthTarget && m_depthTarget == m_depthSurface;
	const uint32_t depthSamples = depthIsSwapChain && m_parameters.MultiSampleType == D3DMULTISAMPLE_4_SAMPLES ? 4 : 1;
	const bool samplesMatch = depthSamples == renderSampleCount() || (depthIsSwapChain && m_depthViewSingle);
	if (m_depthTarget && m_depthTarget->isDepthSurface() &&
		m_depthTarget->width() == colorWidth && m_depthTarget->height() == colorHeight &&
		samplesMatch) {
		return true;
	}
	return !customColorTarget && !m_depthTarget;
}

WGPUTextureView WebGPUD3DDevice::swapChainDepthView() const
{
	return renderSampleCount() == 1 && m_depthViewSingle ? m_depthViewSingle : m_depthView;
}

WGPURenderPipeline WebGPUD3DDevice::pipeline(D3DPRIMITIVETYPE type, const VertexSetup *fixedFunction, UINT stride)
{
	WGPUPrimitiveTopology topology = WGPUPrimitiveTopology_TriangleList;
	switch (type) {
		case D3DPT_POINTLIST: topology = WGPUPrimitiveTopology_PointList; break;
		case D3DPT_LINELIST:
		case D3DPT_LINESTRIP: topology = WGPUPrimitiveTopology_LineList; break;
		default: topology = WGPUPrimitiveTopology_TriangleList; break;
	}
	const uint64_t key = static_cast<uint64_t>(topology) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_ALPHABLENDENABLE] != FALSE) << 2) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_ZENABLE] != D3DZB_FALSE) << 3) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_ZWRITEENABLE] != FALSE) << 4) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_CULLMODE] & 3) << 5) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_SRCBLEND] & 15) << 7) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_DESTBLEND] & 15) << 11) |
		(static_cast<uint64_t>(colorTargetFormat()) & 63) << 15 |
		(static_cast<uint64_t>(m_renderStates[D3DRS_COLORWRITEENABLE] & 15) << 21) |
		(static_cast<uint64_t>(hasDepthTarget()) << 25) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_ZFUNC] & 15) << 26) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_STENCILENABLE] != FALSE) << 30) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_STENCILFAIL] & 15) << 31) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_STENCILZFAIL] & 15) << 35) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_STENCILPASS] & 15) << 39) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_STENCILFUNC] & 15) << 43) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_STENCILMASK] & 0xff) << 47) |
		(static_cast<uint64_t>(m_renderStates[D3DRS_STENCILWRITEMASK] & 0xff) << 55) |
		(static_cast<uint64_t>(renderSampleCount() > 1) << 63);
	// A vertex_vs pipeline is keyed by its program's handle, flagged by bit 63.
	const VertexShaderProgram *program = fixedFunction ? fixedFunction->program : nullptr;
	const std::pair<uint64_t, uint64_t> fixedFunctionKey = {
		key, program ? static_cast<uint64_t>(program->handle) | (static_cast<uint64_t>(stride) << 32) | (1ull << 63)
			: fixedFunction ? static_cast<uint64_t>(fixedFunction->fvf) | (static_cast<uint64_t>(stride) << 32) : 0
	};
	if (fixedFunction) {
		const auto existing = m_fixedFunctionPipelines.find(fixedFunctionKey);
		if (existing != m_fixedFunctionPipelines.end()) {
			return existing->second;
		}
	} else {
		const auto existing = m_pipelines.find(key);
		if (existing != m_pipelines.end()) {
			return existing->second;
		}
	}

	std::array<WGPUVertexAttribute, 7> attributes = {
		WGPU_VERTEX_ATTRIBUTE_INIT,
		WGPU_VERTEX_ATTRIBUTE_INIT,
		WGPU_VERTEX_ATTRIBUTE_INIT,
		WGPU_VERTEX_ATTRIBUTE_INIT,
		WGPU_VERTEX_ATTRIBUTE_INIT,
		WGPU_VERTEX_ATTRIBUTE_INIT,
		WGPU_VERTEX_ATTRIBUTE_INIT,
	};
	attributes[0].format = WGPUVertexFormat_Float32x4;
	attributes[0].offset = offsetof(CanonicalVertex, position);
	attributes[0].shaderLocation = 0;
	attributes[1].format = WGPUVertexFormat_Float32x4;
	attributes[1].offset = offsetof(CanonicalVertex, color);
	attributes[1].shaderLocation = 1;
	attributes[2].format = WGPUVertexFormat_Float32x2;
	attributes[2].offset = offsetof(CanonicalVertex, uv);
	attributes[2].shaderLocation = 2;
	attributes[3].format = WGPUVertexFormat_Float32x2;
	attributes[3].offset = offsetof(CanonicalVertex, uv) + sizeof(float) * 2;
	attributes[3].shaderLocation = 3;
	attributes[4].format = WGPUVertexFormat_Float32x2;
	attributes[4].offset = offsetof(CanonicalVertex, uv) + sizeof(float) * 4;
	attributes[4].shaderLocation = 4;
	attributes[5].format = WGPUVertexFormat_Float32x2;
	attributes[5].offset = offsetof(CanonicalVertex, uv) + sizeof(float) * 6;
	attributes[5].shaderLocation = 5;
	attributes[6].format = WGPUVertexFormat_Float32;
	attributes[6].offset = offsetof(CanonicalVertex, fog);
	attributes[6].shaderLocation = 6;
	WGPUVertexBufferLayout vertexLayout = WGPU_VERTEX_BUFFER_LAYOUT_INIT;
	vertexLayout.stepMode = WGPUVertexStepMode_Vertex;
	vertexLayout.arrayStride = sizeof(CanonicalVertex);
	vertexLayout.attributeCount = attributes.size();
	vertexLayout.attributes = attributes.data();

	// The fixed-function shader reads the application's vertex layout directly;
	// whatever the format lacks comes from the zero buffer in slot 1.
	std::array<WGPUVertexAttribute, 16> rawAttributes = {};
	std::array<WGPUVertexAttribute, 8> defaultAttributes = {};
	std::array<WGPUVertexBufferLayout, 2> rawLayouts = { WGPU_VERTEX_BUFFER_LAYOUT_INIT, WGPU_VERTEX_BUFFER_LAYOUT_INIT };
	WGPUShaderModule vertexModule = m_shader;
	if (program) {
		vertexModule = vertexShaderModule(*program);
		if (!vertexModule) return nullptr;
		// One attribute per input register, from the declaration's last
		// element for it, as executeVertexShader reads them.
		std::array<int, 16> elementOfRegister;
		elementOfRegister.fill(-1);
		for (size_t index = 0; index < program->elements.size(); ++index) {
			elementOfRegister[program->elements[index].vertexRegister] = static_cast<int>(index);
		}
		size_t rawCount = 0;
		for (UINT reg = 0; reg < 16 && rawCount < rawAttributes.size(); ++reg) {
			if (elementOfRegister[reg] < 0) continue;
			const VertexDeclarationElement &element = program->elements[elementOfRegister[reg]];
			WGPUVertexAttribute attribute = WGPU_VERTEX_ATTRIBUTE_INIT;
			attribute.offset = element.offset;
			attribute.shaderLocation = reg;
			switch (element.dataType) {
				case D3DVSDT_FLOAT1: attribute.format = WGPUVertexFormat_Float32; break;
				case D3DVSDT_FLOAT2: attribute.format = WGPUVertexFormat_Float32x2; break;
				case D3DVSDT_FLOAT3: attribute.format = WGPUVertexFormat_Float32x3; break;
				case D3DVSDT_FLOAT4: attribute.format = WGPUVertexFormat_Float32x4; break;
				case D3DVSDT_D3DCOLOR: attribute.format = WGPUVertexFormat_Unorm8x4; break;
				case D3DVSDT_UBYTE4: attribute.format = WGPUVertexFormat_Uint8x4; break;
				case D3DVSDT_SHORT2: attribute.format = WGPUVertexFormat_Sint16x2; break;
				default: attribute.format = WGPUVertexFormat_Sint16x4; break;
			}
			rawAttributes[rawCount++] = attribute;
		}
		rawLayouts[0].stepMode = WGPUVertexStepMode_Vertex;
		rawLayouts[0].arrayStride = stride;
		rawLayouts[0].attributeCount = rawCount;
		rawLayouts[0].attributes = rawAttributes.data();
	} else if (fixedFunction) {
		size_t rawCount = 0;
		size_t defaultCount = 0;
		auto add = [&](bool present, UINT offset, WGPUVertexFormat format, uint32_t location) {
			WGPUVertexAttribute attribute = WGPU_VERTEX_ATTRIBUTE_INIT;
			attribute.format = format;
			attribute.offset = present ? offset : 0;
			attribute.shaderLocation = location;
			if (present) rawAttributes[rawCount++] = attribute;
			else defaultAttributes[defaultCount++] = attribute;
		};
		add(true, 0, WGPUVertexFormat_Float32x3, 0);
		add(fixedFunction->hasNormal, fixedFunction->normalOffset, WGPUVertexFormat_Float32x3, 1);
		add(fixedFunction->hasDiffuse, fixedFunction->diffuseOffset, WGPUVertexFormat_Unorm8x4, 2);
		add(fixedFunction->hasSpecular, fixedFunction->specularOffset, WGPUVertexFormat_Unorm8x4, 3);
		for (UINT stage = 0; stage < 4; ++stage) {
			const bool present = stage < fixedFunction->textureCount;
			const UINT count = present ? fixedFunction->uvCoordinateCount[stage] : 2;
			const WGPUVertexFormat format = count == 1 ? WGPUVertexFormat_Float32
				: count == 3 ? WGPUVertexFormat_Float32x3
				: count == 4 ? WGPUVertexFormat_Float32x4 : WGPUVertexFormat_Float32x2;
			add(present, present ? fixedFunction->uvOffset[stage] : 0, format, 4 + stage);
		}
		rawLayouts[0].stepMode = WGPUVertexStepMode_Vertex;
		rawLayouts[0].arrayStride = stride;
		rawLayouts[0].attributeCount = rawCount;
		rawLayouts[0].attributes = rawAttributes.data();
		rawLayouts[1].stepMode = WGPUVertexStepMode_Vertex;
		rawLayouts[1].arrayStride = 0;
		rawLayouts[1].attributeCount = defaultCount;
		rawLayouts[1].attributes = defaultAttributes.data();
	}

	WGPUBlendState blend = WGPU_BLEND_STATE_INIT;
	blend.color.operation = WGPUBlendOperation_Add;
	blend.color.srcFactor = blendFactor(m_renderStates[D3DRS_SRCBLEND]);
	blend.color.dstFactor = blendFactor(m_renderStates[D3DRS_DESTBLEND]);
	blend.alpha = blend.color;
	WGPUColorTargetState target = WGPU_COLOR_TARGET_STATE_INIT;
	target.format = colorTargetFormat();
	target.blend = m_renderStates[D3DRS_ALPHABLENDENABLE] ? &blend : nullptr;
	target.writeMask = WGPUColorWriteMask_None;
	if (m_renderStates[D3DRS_COLORWRITEENABLE] & D3DCOLORWRITEENABLE_RED) target.writeMask |= WGPUColorWriteMask_Red;
	if (m_renderStates[D3DRS_COLORWRITEENABLE] & D3DCOLORWRITEENABLE_GREEN) target.writeMask |= WGPUColorWriteMask_Green;
	if (m_renderStates[D3DRS_COLORWRITEENABLE] & D3DCOLORWRITEENABLE_BLUE) target.writeMask |= WGPUColorWriteMask_Blue;
	if (m_renderStates[D3DRS_COLORWRITEENABLE] & D3DCOLORWRITEENABLE_ALPHA) target.writeMask |= WGPUColorWriteMask_Alpha;
	WGPUFragmentState fragment = WGPU_FRAGMENT_STATE_INIT;
	fragment.module = m_shader;
	fragment.entryPoint = MakeStringView("fragment_main");
	fragment.targetCount = 1;
	fragment.targets = &target;

	WGPUDepthStencilState depth = WGPU_DEPTH_STENCIL_STATE_INIT;
	depth.format = WGPUTextureFormat_Depth24PlusStencil8;
	depth.depthWriteEnabled = m_renderStates[D3DRS_ZWRITEENABLE] ? WGPUOptionalBool_True : WGPUOptionalBool_False;
	depth.depthCompare = m_renderStates[D3DRS_ZENABLE] == D3DZB_FALSE
		? WGPUCompareFunction_Always : compareFunction(m_renderStates[D3DRS_ZFUNC]);
	depth.stencilFront.compare = m_renderStates[D3DRS_STENCILENABLE]
		? compareFunction(m_renderStates[D3DRS_STENCILFUNC]) : WGPUCompareFunction_Always;
	depth.stencilFront.failOp = stencilOperation(m_renderStates[D3DRS_STENCILFAIL]);
	depth.stencilFront.depthFailOp = stencilOperation(m_renderStates[D3DRS_STENCILZFAIL]);
	depth.stencilFront.passOp = stencilOperation(m_renderStates[D3DRS_STENCILPASS]);
	depth.stencilBack = depth.stencilFront;
	depth.stencilReadMask = m_renderStates[D3DRS_STENCILENABLE] ? m_renderStates[D3DRS_STENCILMASK] & 0xff : 0xff;
	depth.stencilWriteMask = m_renderStates[D3DRS_STENCILENABLE] ? m_renderStates[D3DRS_STENCILWRITEMASK] & 0xff : 0;
	WGPURenderPipelineDescriptor descriptor = WGPU_RENDER_PIPELINE_DESCRIPTOR_INIT;
	descriptor.layout = fixedFunction ? m_fixedFunctionPipelineLayout : m_pipelineLayout;
	descriptor.vertex.module = vertexModule;
	descriptor.vertex.entryPoint = MakeStringView(program ? "vertex_vs" : fixedFunction ? "vertex_ff" : "vertex_main");
	descriptor.vertex.bufferCount = program ? 1 : fixedFunction ? rawLayouts.size() : 1;
	descriptor.vertex.buffers = fixedFunction ? rawLayouts.data() : &vertexLayout;
	descriptor.primitive.topology = topology;
	// GeneralsX @port Codex 04/08/2026 Match Direct3D screen-space winding after converting Y-down coordinates to WebGPU NDC.
	descriptor.primitive.frontFace = WGPUFrontFace_CW;
	switch (m_renderStates[D3DRS_CULLMODE]) {
		case D3DCULL_CW: descriptor.primitive.cullMode = WGPUCullMode_Front; break;
		case D3DCULL_CCW: descriptor.primitive.cullMode = WGPUCullMode_Back; break;
		default: descriptor.primitive.cullMode = WGPUCullMode_None; break;
	}
	descriptor.depthStencil = hasDepthTarget() ? &depth : nullptr;
	descriptor.multisample.count = renderSampleCount();
	descriptor.multisample.mask = 0xffffffff;
	descriptor.multisample.alphaToCoverageEnabled = WGPU_FALSE;
	descriptor.fragment = &fragment;
	WGPURenderPipeline created = wgpuDeviceCreateRenderPipeline(webGPUDevice(), &descriptor);
	if (created) {
		if (fixedFunction) m_fixedFunctionPipelines.emplace(fixedFunctionKey, created);
		else m_pipelines.emplace(key, created);
	}
	return created;
}

WebGPUD3DDevice::DrawBindings WebGPUD3DDevice::bindGroup()
{
	UploadFrame &frame = m_uploadFrames[m_activeUploadFrame];
	std::array<WGPUTextureView, 4> textureViews = {};
	std::array<WGPUSampler, 4> samplers = {};
	for (UINT stage = 0; stage < textureViews.size(); ++stage) {
		textureViews[stage] = m_whiteView;
		if (m_textures[stage] && (m_pixelShader || m_textureStates[stage][D3DTSS_COLOROP] != D3DTOP_DISABLE)) {
			textureViews[stage] = m_textures[stage]->view();
		}
		if (!textureViews[stage]) {
			textureViews[stage] = m_whiteView;
		}
		samplers[stage] = sampler(stage);
		if (!samplers[stage]) {
			return {};
		}
	}
	std::array<uintptr_t, 8> bindingKey = {};
	for (UINT stage = 0; stage < textureViews.size(); ++stage) {
		bindingKey[stage * 2] = reinterpret_cast<uintptr_t>(samplers[stage]);
		bindingKey[stage * 2 + 1] = reinterpret_cast<uintptr_t>(textureViews[stage]);
	}
	PixelShaderProgram pixelShader = {};
	if (m_pixelShader) {
		const auto program = m_pixelShaders.find(m_pixelShader);
		if (program == m_pixelShaders.end()) {
			return {};
		}
		pixelShader = program->second;
	}
	const DWORD textureFactor = m_renderStates[D3DRS_TEXTUREFACTOR];
	const DWORD fogColor = m_renderStates[D3DRS_FOGCOLOR];
	TextureCombinerUniforms uniforms = {
		m_textureStates[0][D3DTSS_COLOROP],
		m_textureStates[0][D3DTSS_COLORARG1],
		m_textureStates[0][D3DTSS_COLORARG2],
		m_textureStates[0][D3DTSS_ALPHAOP],
		m_textureStates[0][D3DTSS_ALPHAARG1],
		m_textureStates[0][D3DTSS_ALPHAARG2],
		m_textureStates[1][D3DTSS_COLOROP],
		m_textureStates[1][D3DTSS_COLORARG1],
		m_textureStates[1][D3DTSS_COLORARG2],
		m_textureStates[1][D3DTSS_ALPHAOP],
		m_textureStates[1][D3DTSS_ALPHAARG1],
		m_textureStates[1][D3DTSS_ALPHAARG2],
		m_textureStates[2][D3DTSS_COLOROP],
		m_textureStates[2][D3DTSS_COLORARG1],
		m_textureStates[2][D3DTSS_COLORARG2],
		m_textureStates[2][D3DTSS_ALPHAOP],
		m_textureStates[2][D3DTSS_ALPHAARG1],
		m_textureStates[2][D3DTSS_ALPHAARG2],
		m_textureStates[3][D3DTSS_COLOROP],
		m_textureStates[3][D3DTSS_COLORARG1],
		m_textureStates[3][D3DTSS_COLORARG2],
		m_textureStates[3][D3DTSS_ALPHAOP],
		m_textureStates[3][D3DTSS_ALPHAARG1],
		m_textureStates[3][D3DTSS_ALPHAARG2],
		{
			static_cast<float>((textureFactor >> 16) & 0xff) / 255.0f,
			static_cast<float>((textureFactor >> 8) & 0xff) / 255.0f,
			static_cast<float>(textureFactor & 0xff) / 255.0f,
			static_cast<float>((textureFactor >> 24) & 0xff) / 255.0f,
		},
		{
			static_cast<float>((fogColor >> 16) & 0xff) / 255.0f,
			static_cast<float>((fogColor >> 8) & 0xff) / 255.0f,
			static_cast<float>(fogColor & 0xff) / 255.0f,
			1.0f,
		},
		static_cast<float>(m_renderStates[D3DRS_ALPHAREF] & 0xff) / 255.0f,
		m_renderStates[D3DRS_ALPHAFUNC],
		m_renderStates[D3DRS_ALPHATESTENABLE],
		(pixelShader.mode != 0 && !m_renderStates[D3DRS_ALPHABLENDENABLE]) ? 1u : 0u,
		pixelShader.mode,
		pixelShader.textureCount,
		0,
		0,
	};
	const size_t uniformOffset = (frame.uniforms.size() + kUniformOffsetAlignment - 1) & ~(kUniformOffsetAlignment - 1);
	if (uniformOffset + sizeof(uniforms) > kUniformUploadCapacity) {
		return {};
	}
	frame.uniforms.resize(uniformOffset + sizeof(uniforms));
	std::memcpy(frame.uniforms.data() + uniformOffset, &uniforms, sizeof(uniforms));
	const auto existing = frame.bindGroups.find(bindingKey);
	if (existing != frame.bindGroups.end()) {
		return { existing->second, static_cast<uint32_t>(uniformOffset) };
	}
	std::array<WGPUBindGroupEntry, 9> entries = {
		WGPU_BIND_GROUP_ENTRY_INIT,
		WGPU_BIND_GROUP_ENTRY_INIT,
		WGPU_BIND_GROUP_ENTRY_INIT,
		WGPU_BIND_GROUP_ENTRY_INIT,
		WGPU_BIND_GROUP_ENTRY_INIT,
		WGPU_BIND_GROUP_ENTRY_INIT,
		WGPU_BIND_GROUP_ENTRY_INIT,
		WGPU_BIND_GROUP_ENTRY_INIT,
		WGPU_BIND_GROUP_ENTRY_INIT,
	};
	for (UINT stage = 0; stage < textureViews.size(); ++stage) {
		entries[stage * 2].binding = stage * 2;
		entries[stage * 2].sampler = samplers[stage];
		entries[stage * 2 + 1].binding = stage * 2 + 1;
		entries[stage * 2 + 1].textureView = textureViews[stage];
	}
	entries[8].binding = 8;
	entries[8].buffer = frame.uniformBuffer;
	entries[8].offset = 0;
	entries[8].size = sizeof(uniforms);
	WGPUBindGroupDescriptor descriptor = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
	descriptor.layout = m_bindGroupLayout;
	descriptor.entryCount = entries.size();
	descriptor.entries = entries.data();
	WGPUBindGroup group = wgpuDeviceCreateBindGroup(webGPUDevice(), &descriptor);
	if (group) {
		frame.bindGroups.emplace(bindingKey, group);
	}
	return { group, static_cast<uint32_t>(uniformOffset) };
}

// A texture is going away: drop the cached bind groups that hold its view,
// before a new view can reuse the pointer the cache keys on.
void WebGPUD3DDevice::forgetTextureView(WGPUTextureView view)
{
	const uintptr_t key = reinterpret_cast<uintptr_t>(view);
	for (UploadFrame &frame : m_uploadFrames) {
		for (auto it = frame.bindGroups.begin(); it != frame.bindGroups.end();) {
			const auto &binding = it->first;
			if (binding[1] == key || binding[3] == key || binding[5] == key || binding[7] == key) {
				wgpuBindGroupRelease(it->second);
				it = frame.bindGroups.erase(it);
			} else {
				++it;
			}
		}
	}
}

WGPUSampler WebGPUD3DDevice::sampler(UINT stage)
{
	const auto &states = m_textureStates[stage];
	const DWORD addressU = states[D3DTSS_ADDRESSU];
	const DWORD addressV = states[D3DTSS_ADDRESSV];
	const DWORD magFilter = states[D3DTSS_MAGFILTER];
	const DWORD minFilter = states[D3DTSS_MINFILTER];
	const DWORD mipFilter = states[D3DTSS_MIPFILTER];
	const DWORD maxMipLevel = states[D3DTSS_MAXMIPLEVEL];
	const DWORD maxAnisotropy = std::clamp(states[D3DTSS_MAXANISOTROPY], DWORD{ 1 }, DWORD{ 16 });
	const uint64_t key = static_cast<uint64_t>(addressU & 7) |
		(static_cast<uint64_t>(addressV & 7) << 3) |
		(static_cast<uint64_t>(magFilter & 7) << 6) |
		(static_cast<uint64_t>(minFilter & 7) << 9) |
		(static_cast<uint64_t>(mipFilter & 7) << 12) |
		(static_cast<uint64_t>(maxMipLevel & 15) << 15) |
		(static_cast<uint64_t>(maxAnisotropy & 31) << 19);
	const auto existing = m_samplers.find(key);
	if (existing != m_samplers.end()) {
		return existing->second;
	}

	auto addressMode = [](DWORD address) {
		switch (address) {
			case D3DTADDRESS_MIRROR: return WGPUAddressMode_MirrorRepeat;
			case D3DTADDRESS_CLAMP:
			case D3DTADDRESS_BORDER:
			case D3DTADDRESS_MIRRORONCE: return WGPUAddressMode_ClampToEdge;
			default: return WGPUAddressMode_Repeat;
		}
	};
	auto filterMode = [](DWORD filter) {
		return filter == D3DTEXF_LINEAR || filter == D3DTEXF_ANISOTROPIC
			? WGPUFilterMode_Linear : WGPUFilterMode_Nearest;
	};
	const bool anisotropic = minFilter == D3DTEXF_ANISOTROPIC;
	WGPUSamplerDescriptor descriptor = WGPU_SAMPLER_DESCRIPTOR_INIT;
	descriptor.addressModeU = addressMode(addressU);
	descriptor.addressModeV = addressMode(addressV);
	descriptor.addressModeW = WGPUAddressMode_Repeat;
	descriptor.magFilter = anisotropic ? WGPUFilterMode_Linear : filterMode(magFilter);
	descriptor.minFilter = anisotropic ? WGPUFilterMode_Linear : filterMode(minFilter);
	// WebGPU rejects an anisotropic sampler unless all three filters are linear.
	descriptor.mipmapFilter = anisotropic || mipFilter == D3DTEXF_LINEAR
		? WGPUMipmapFilterMode_Linear : WGPUMipmapFilterMode_Nearest;
	descriptor.lodMinClamp = static_cast<float>(maxMipLevel);
	descriptor.lodMaxClamp = mipFilter == D3DTEXF_NONE ? static_cast<float>(maxMipLevel) : 32.0f;
	descriptor.maxAnisotropy = anisotropic ? maxAnisotropy : 1;
	WGPUSampler created = wgpuDeviceCreateSampler(webGPUDevice(), &descriptor);
	if (created) {
		m_samplers.emplace(key, created);
	}
	return created;
}

UINT WebGPUD3DDevice::vertexCountFor(D3DPRIMITIVETYPE type, UINT primitiveCount) const
{
	switch (type) {
		case D3DPT_POINTLIST: return primitiveCount;
		case D3DPT_LINELIST: return primitiveCount * 2;
		case D3DPT_LINESTRIP: return primitiveCount + 1;
		case D3DPT_TRIANGLELIST: return primitiveCount * 3;
		case D3DPT_TRIANGLESTRIP:
		case D3DPT_TRIANGLEFAN: return primitiveCount + 2;
		default: return 0;
	}
}

D3DMATRIX WebGPUD3DDevice::identityMatrix() const
{
	D3DMATRIX matrix = {};
	matrix.m[0][0] = 1.0f;
	matrix.m[1][1] = 1.0f;
	matrix.m[2][2] = 1.0f;
	matrix.m[3][3] = 1.0f;
	return matrix;
}

CanonicalVertex WebGPUD3DDevice::executeVertexShader(const VertexShaderProgram &program, const uint8_t *source, UINT stride) const
{
	using Vector = std::array<float, 4>;
	std::array<Vector, 16> inputs = {};
	std::array<Vector, 12> temporaries = {};
	std::array<Vector, 3> rasterOutputs = {};
	std::array<Vector, 2> attributeOutputs = {};
	std::array<Vector, 8> textureOutputs = {};
	Vector address = {};
	rasterOutputs[0][3] = 1.0f;
	attributeOutputs[0] = { 1.0f, 1.0f, 1.0f, 1.0f };
	for (const VertexDeclarationElement &element : program.elements) {
		if (element.vertexRegister >= inputs.size() || element.offset >= stride) continue;
		Vector value = { 0.0f, 0.0f, 0.0f, 1.0f };
		const uint8_t *data = source + element.offset;
		switch (element.dataType) {
			case D3DVSDT_FLOAT1:
			case D3DVSDT_FLOAT2:
			case D3DVSDT_FLOAT3:
			case D3DVSDT_FLOAT4: {
				const UINT count = element.dataType + 1;
				if (element.offset + count * sizeof(float) > stride) continue;
				std::copy_n(reinterpret_cast<const float *>(data), count, value.begin());
				break;
			}
			case D3DVSDT_D3DCOLOR: {
				if (element.offset + sizeof(DWORD) > stride) continue;
				const DWORD color = *reinterpret_cast<const DWORD *>(data);
				value = {
					static_cast<float>((color >> 16) & 0xff) / 255.0f,
					static_cast<float>((color >> 8) & 0xff) / 255.0f,
					static_cast<float>(color & 0xff) / 255.0f,
					static_cast<float>((color >> 24) & 0xff) / 255.0f
				};
				break;
			}
			case D3DVSDT_UBYTE4:
				if (element.offset + 4 > stride) continue;
				for (UINT component = 0; component < 4; ++component) value[component] = data[component];
				break;
			case D3DVSDT_SHORT2:
			case D3DVSDT_SHORT4: {
				const UINT count = element.dataType == D3DVSDT_SHORT2 ? 2 : 4;
				if (element.offset + count * sizeof(int16_t) > stride) continue;
				const auto *values = reinterpret_cast<const int16_t *>(data);
				for (UINT component = 0; component < count; ++component) value[component] = values[component];
				break;
			}
			default:
				continue;
		}
		inputs[element.vertexRegister] = value;
	}
	auto readSource = [&](DWORD token, int constantOffset = 0) {
		Vector value = {};
		const DWORD type = token & D3DSP_REGTYPE_MASK;
		UINT index = token & 0x7ff;
		if (type == D3DSPR_TEMP && index < temporaries.size()) value = temporaries[index];
		else if (type == D3DSPR_INPUT && index < inputs.size()) value = inputs[index];
		else if (type == D3DSPR_CONST) {
			if (token & D3DVS_ADDRESSMODE_MASK) index += static_cast<UINT>(std::max(0.0f, std::floor(address[0] + 0.5f)));
			index += constantOffset;
			if (index < m_vertexShaderConstants.size()) value = m_vertexShaderConstants[index];
		} else if (type == D3DSPR_ADDR) {
			value = address;
		}
		Vector swizzled = {};
		for (UINT component = 0; component < 4; ++component) {
			swizzled[component] = value[(token >> (D3DVS_SWIZZLE_SHIFT + component * 2)) & 3];
		}
		if ((token & D3DSP_SRCMOD_MASK) == D3DSPSM_NEG) {
			for (float &component : swizzled) component = -component;
		}
		return swizzled;
	};
	auto writeDestination = [&](DWORD token, const Vector &value) {
		Vector *destination = nullptr;
		const DWORD type = token & D3DSP_REGTYPE_MASK;
		const UINT index = token & 0x7ff;
		if (type == D3DSPR_TEMP && index < temporaries.size()) destination = &temporaries[index];
		else if (type == D3DSPR_ADDR) destination = &address;
		else if (type == D3DSPR_RASTOUT && index < rasterOutputs.size()) destination = &rasterOutputs[index];
		else if (type == D3DSPR_ATTROUT && index < attributeOutputs.size()) destination = &attributeOutputs[index];
		else if (type == D3DSPR_TEXCRDOUT && index < textureOutputs.size()) destination = &textureOutputs[index];
		if (!destination) return;
		for (UINT component = 0; component < 4; ++component) {
			if (token & (D3DSP_WRITEMASK_0 << component)) (*destination)[component] = value[component];
		}
	};
	for (const VertexShaderInstruction &instruction : program.instructions) {
		Vector result = {};
		const Vector first = readSource(instruction.sources[0]);
		const Vector second = instruction.sourceCount > 1 ? readSource(instruction.sources[1]) : Vector{};
		const Vector third = instruction.sourceCount > 2 ? readSource(instruction.sources[2]) : Vector{};
		switch (instruction.opcode) {
			case D3DSIO_MOV:
				result = first;
				break;
			case D3DSIO_ADD:
				for (UINT component = 0; component < 4; ++component) result[component] = first[component] + second[component];
				break;
			case D3DSIO_SUB:
				for (UINT component = 0; component < 4; ++component) result[component] = first[component] - second[component];
				break;
			case D3DSIO_MUL:
				for (UINT component = 0; component < 4; ++component) result[component] = first[component] * second[component];
				break;
			case D3DSIO_MAD:
				for (UINT component = 0; component < 4; ++component) result[component] = first[component] * second[component] + third[component];
				break;
			case D3DSIO_M4x4:
				for (UINT row = 0; row < 4; ++row) {
					const Vector matrixRow = readSource(instruction.sources[1], row);
					for (UINT component = 0; component < 4; ++component) result[row] += first[component] * matrixRow[component];
				}
				break;
			default:
				continue;
		}
		writeDestination(instruction.destination, result);
	}
	CanonicalVertex output = {};
	std::copy(rasterOutputs[0].begin(), rasterOutputs[0].end(), output.position);
	output.position[0] += output.position[3] / static_cast<float>(m_viewport.Width);
	output.position[1] -= output.position[3] / static_cast<float>(m_viewport.Height);
	std::copy(attributeOutputs[0].begin(), attributeOutputs[0].end(), output.color);
	for (UINT stage = 0; stage < 4; ++stage) {
		output.uv[stage][0] = textureOutputs[stage][0];
		output.uv[stage][1] = textureOutputs[stage][1];
	}
	output.fog = rasterOutputs[1][0] == 0.0f ? 1.0f : rasterOutputs[1][0];
	return output;
}

void WebGPUD3DDevice::prepareVertexSetup(VertexSetup &setup) const
{
	setup = {};
	const auto programmableShader = m_vertexShaders.find(m_vertexShader);
	if (programmableShader != m_vertexShaders.end()) {
		setup.program = &programmableShader->second;
		return;
	}
	const DWORD fvf = m_vertexShader ? m_vertexShader : (m_vertexBuffer ? m_vertexBuffer->fvf() : D3DFVF_XYZ);
	const DWORD positionType = fvf & D3DFVF_POSITION_MASK;
	setup.fvf = fvf;
	setup.positionType = positionType;
	setup.rhw = positionType == D3DFVF_XYZRHW;
	const auto worldTransform = m_transforms.find(D3DTS_WORLD);
	const auto viewTransform = m_transforms.find(D3DTS_VIEW);
	const auto projectionTransform = m_transforms.find(D3DTS_PROJECTION);
	setup.world = worldTransform == m_transforms.end() ? identityMatrix() : worldTransform->second;
	setup.view = viewTransform == m_transforms.end() ? identityMatrix() : viewTransform->second;
	setup.projection = projectionTransform == m_transforms.end() ? identityMatrix() : projectionTransform->second;
	setup.viewportX = static_cast<float>(m_viewport.X);
	setup.viewportY = static_cast<float>(m_viewport.Y);
	setup.viewportWidth = static_cast<float>(m_viewport.Width);
	setup.viewportHeight = static_cast<float>(m_viewport.Height);

	UINT offset = 0;
	if (setup.rhw) {
		offset = 4 * sizeof(float);
	} else {
		offset = 3 * sizeof(float);
		if (positionType >= D3DFVF_XYZB1 && positionType <= D3DFVF_XYZB5) {
			offset += ((positionType - D3DFVF_XYZB1) / 2 + 1) * sizeof(float);
		}
	}
	const D3DMATRIX &worldMatrix = setup.world;
	const D3DMATRIX &viewMatrix = setup.view;
	setup.hasNormal = (fvf & D3DFVF_NORMAL) != 0;
	if (setup.hasNormal) {
		setup.normalOffset = offset;
		float worldView[3][3] = {};
		for (int row = 0; row < 3; ++row) {
			for (int column = 0; column < 3; ++column) {
				for (int index = 0; index < 3; ++index) {
					worldView[row][column] += worldMatrix.m[row][index] * viewMatrix.m[index][column];
				}
			}
		}
		const float determinant =
			worldView[0][0] * (worldView[1][1] * worldView[2][2] - worldView[1][2] * worldView[2][1]) -
			worldView[0][1] * (worldView[1][0] * worldView[2][2] - worldView[1][2] * worldView[2][0]) +
			worldView[0][2] * (worldView[1][0] * worldView[2][1] - worldView[1][1] * worldView[2][0]);
		if (std::abs(determinant) > 1.0e-20f) {
			const float inverseDeterminant = 1.0f / determinant;
			const float inverse[3][3] = {
				{ (worldView[1][1] * worldView[2][2] - worldView[1][2] * worldView[2][1]) * inverseDeterminant,
				  (worldView[0][2] * worldView[2][1] - worldView[0][1] * worldView[2][2]) * inverseDeterminant,
				  (worldView[0][1] * worldView[1][2] - worldView[0][2] * worldView[1][1]) * inverseDeterminant },
				{ (worldView[1][2] * worldView[2][0] - worldView[1][0] * worldView[2][2]) * inverseDeterminant,
				  (worldView[0][0] * worldView[2][2] - worldView[0][2] * worldView[2][0]) * inverseDeterminant,
				  (worldView[0][2] * worldView[1][0] - worldView[0][0] * worldView[1][2]) * inverseDeterminant },
				{ (worldView[1][0] * worldView[2][1] - worldView[1][1] * worldView[2][0]) * inverseDeterminant,
				  (worldView[0][1] * worldView[2][0] - worldView[0][0] * worldView[2][1]) * inverseDeterminant,
				  (worldView[0][0] * worldView[1][1] - worldView[0][1] * worldView[1][0]) * inverseDeterminant }
			};
			std::memcpy(setup.normalInverse, inverse, sizeof(inverse));
			setup.normalInvertible = true;
		}
		offset += 3 * sizeof(float);
		setup.normalizeNormals = m_renderStates[D3DRS_NORMALIZENORMALS] != FALSE;
	}
	setup.fogEnabled = !setup.rhw && m_renderStates[D3DRS_FOGENABLE] != FALSE;
	if (setup.fogEnabled) {
		setup.fogMode = m_renderStates[D3DRS_FOGVERTEXMODE];
		setup.fogRange = m_renderStates[D3DRS_RANGEFOGENABLE] != FALSE;
		setup.fogDensity = std::bit_cast<float>(m_renderStates[D3DRS_FOGDENSITY]);
		setup.fogStart = std::bit_cast<float>(m_renderStates[D3DRS_FOGSTART]);
		setup.fogEnd = std::bit_cast<float>(m_renderStates[D3DRS_FOGEND]);
	}
	if (fvf & D3DFVF_PSIZE) {
		offset += sizeof(float);
	}
	setup.hasDiffuse = (fvf & D3DFVF_DIFFUSE) != 0;
	if (setup.hasDiffuse) {
		setup.diffuseOffset = offset;
		offset += sizeof(DWORD);
	}
	setup.hasSpecular = (fvf & D3DFVF_SPECULAR) != 0;
	if (setup.hasSpecular) {
		setup.specularOffset = offset;
		setup.fogFromSpecular = m_renderStates[D3DRS_FOGENABLE] != FALSE && m_renderStates[D3DRS_FOGVERTEXMODE] == D3DFOG_NONE;
		offset += sizeof(DWORD);
	}

	setup.lighting = !setup.rhw && setup.hasNormal && m_renderStates[D3DRS_LIGHTING] != FALSE;
	if (setup.lighting) {
		auto source = [&](DWORD state) {
			if (m_renderStates[D3DRS_COLORVERTEX] != FALSE) {
				if (state == D3DMCS_COLOR1 && setup.hasDiffuse) return VertexSetup::MaterialSource::VertexDiffuse;
				if (state == D3DMCS_COLOR2 && setup.hasSpecular) return VertexSetup::MaterialSource::VertexSpecular;
			}
			return VertexSetup::MaterialSource::Material;
		};
		auto copyColor = [](float (&destination)[4], const D3DCOLORVALUE &value) {
			destination[0] = value.r;
			destination[1] = value.g;
			destination[2] = value.b;
			destination[3] = value.a;
		};
		setup.diffuseSource = source(m_renderStates[D3DRS_DIFFUSEMATERIALSOURCE]);
		setup.ambientSource = source(m_renderStates[D3DRS_AMBIENTMATERIALSOURCE]);
		setup.emissiveSource = source(m_renderStates[D3DRS_EMISSIVEMATERIALSOURCE]);
		copyColor(setup.materialDiffuse, m_material.Diffuse);
		copyColor(setup.materialAmbient, m_material.Ambient);
		copyColor(setup.materialEmissive, m_material.Emissive);
		const DWORD ambientColor = m_renderStates[D3DRS_AMBIENT];
		setup.globalAmbient[0] = static_cast<float>((ambientColor >> 16) & 0xff) / 255.0f;
		setup.globalAmbient[1] = static_cast<float>((ambientColor >> 8) & 0xff) / 255.0f;
		setup.globalAmbient[2] = static_cast<float>(ambientColor & 0xff) / 255.0f;
		setup.globalAmbient[3] = static_cast<float>((ambientColor >> 24) & 0xff) / 255.0f;
		auto transform = [](const std::array<float, 4> &input, const D3DMATRIX &matrix) {
			std::array<float, 4> result = {};
			for (int column = 0; column < 4; ++column) {
				for (int row = 0; row < 4; ++row) {
					result[column] += input[row] * matrix.m[row][column];
				}
			}
			return result;
		};
		for (DWORD index = 0; index < 8; ++index) {
			const auto enabled = m_lightEnabled.find(index);
			const auto found = m_lights.find(index);
			if (enabled == m_lightEnabled.end() || enabled->second == FALSE || found == m_lights.end()) continue;
			const D3DLIGHT8 &light = found->second;
			VertexSetup::Light &out = setup.lights[setup.lightCount++];
			std::array<float, 4> position = { light.Position.x, light.Position.y, light.Position.z, 1.0f };
			std::array<float, 4> direction = { light.Direction.x, light.Direction.y, light.Direction.z, 0.0f };
			position = transform(position, viewMatrix);
			direction = transform(direction, viewMatrix);
			float directionLength = std::sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]);
			if (directionLength > 0.0f) {
				for (int component = 0; component < 3; ++component) direction[component] /= directionLength;
			}
			out.type = light.Type;
			std::copy(position.begin(), position.end(), out.position);
			std::copy(direction.begin(), direction.end(), out.direction);
			out.range = light.Range;
			out.attenuation0 = light.Attenuation0;
			out.attenuation1 = light.Attenuation1;
			out.attenuation2 = light.Attenuation2;
			out.falloff = light.Falloff;
			out.cosHalfTheta = std::cos(light.Theta * 0.5f);
			out.cosHalfPhi = std::cos(light.Phi * 0.5f);
			copyColor(out.ambient, light.Ambient);
			copyColor(out.diffuse, light.Diffuse);
		}
	}

	const UINT textureCount = (fvf & D3DFVF_TEXCOUNT_MASK) >> D3DFVF_TEXCOUNT_SHIFT;
	for (UINT stage = 0; stage < std::min(textureCount, 4U); ++stage) {
		const UINT sizeBits = (fvf >> (16 + stage * 2)) & 3;
		const UINT coordinateCount = sizeBits == 0 ? 2 : sizeBits == 1 ? 3 : sizeBits == 2 ? 4 : 1;
		setup.uvOffset[stage] = offset;
		setup.uvCoordinateCount[stage] = coordinateCount;
		setup.textureCount = stage + 1;
		offset += coordinateCount * sizeof(float);
	}
	for (UINT stage = 0; stage < 4; ++stage) {
		VertexSetup::TextureStage &out = setup.stages[stage];
		const DWORD coordinateState = m_textureStates[stage][D3DTSS_TEXCOORDINDEX];
		const DWORD generationMode = coordinateState & 0xffff0000;
		out.cameraSpacePosition = !setup.rhw && generationMode == D3DTSS_TCI_CAMERASPACEPOSITION;
		const UINT coordinateIndex = coordinateState & 0xffff;
		out.coordinateIndex = coordinateIndex < 4 ? coordinateIndex : 0;
		if (m_textureStates[stage][D3DTSS_TEXTURETRANSFORMFLAGS] != D3DTTFF_DISABLE) {
			const auto textureTransform = m_transforms.find(static_cast<DWORD>(D3DTS_TEXTURE0) + stage);
			if (textureTransform != m_transforms.end()) {
				out.hasTransform = true;
				out.transform = &textureTransform->second;
			}
		}
	}
}

CanonicalVertex WebGPUD3DDevice::convertVertex(const uint8_t *source, UINT stride, const VertexSetup &setup) const
{
	if (setup.program) {
		return executeVertexShader(*setup.program, source, stride);
	}
	CanonicalVertex output = {};
	std::fill(std::begin(output.color), std::end(output.color), 1.0f);
	output.fog = 1.0f;
	std::array<float, 4> cameraPosition = {};
	auto transform = [](const std::array<float, 4> &input, const D3DMATRIX &matrix) {
		std::array<float, 4> result = {};
		for (int column = 0; column < 4; ++column) {
			for (int row = 0; row < 4; ++row) {
				result[column] += input[row] * matrix.m[row][column];
			}
		}
		return result;
	};
	if (setup.rhw) {
		const float *position = reinterpret_cast<const float *>(source);
		output.position[0] = ((position[0] - setup.viewportX) / setup.viewportWidth) * 2.0f - 1.0f;
		output.position[1] = 1.0f - ((position[1] - setup.viewportY) / setup.viewportHeight) * 2.0f;
		output.position[2] = position[2];
		output.position[3] = 1.0f;
	} else {
		std::array<float, 4> position = {
			reinterpret_cast<const float *>(source)[0],
			reinterpret_cast<const float *>(source)[1],
			reinterpret_cast<const float *>(source)[2],
			1.0f,
		};
		position = transform(position, setup.world);
		cameraPosition = transform(position, setup.view);
		position = transform(cameraPosition, setup.projection);
		std::copy(position.begin(), position.end(), output.position);
	}
	output.position[0] += output.position[3] / setup.viewportWidth;
	output.position[1] -= output.position[3] / setup.viewportHeight;
	std::array<float, 3> cameraNormal = {};
	if (setup.hasNormal) {
		const float *normal = reinterpret_cast<const float *>(source + setup.normalOffset);
		if (setup.normalInvertible) {
			for (int column = 0; column < 3; ++column) {
				for (int row = 0; row < 3; ++row) {
					cameraNormal[column] += normal[row] * setup.normalInverse[column][row];
				}
			}
		}
		if (setup.normalizeNormals) {
			const float length = std::sqrt(cameraNormal[0] * cameraNormal[0] + cameraNormal[1] * cameraNormal[1] + cameraNormal[2] * cameraNormal[2]);
			if (length > 0.0f) {
				for (float &component : cameraNormal) component /= length;
			}
		}
	}
	if (setup.fogEnabled) {
		const float fogDistance = setup.fogRange
			? std::sqrt(cameraPosition[0] * cameraPosition[0] + cameraPosition[1] * cameraPosition[1] + cameraPosition[2] * cameraPosition[2])
			: std::abs(cameraPosition[2]);
		switch (setup.fogMode) {
			case D3DFOG_LINEAR:
				output.fog = setup.fogEnd == setup.fogStart ? (fogDistance <= setup.fogEnd ? 1.0f : 0.0f)
					: (setup.fogEnd - fogDistance) / (setup.fogEnd - setup.fogStart);
				break;
			case D3DFOG_EXP:
				output.fog = std::exp(-setup.fogDensity * fogDistance);
				break;
			case D3DFOG_EXP2: {
				const float densityDistance = setup.fogDensity * fogDistance;
				output.fog = std::exp(-densityDistance * densityDistance);
				break;
			}
			default:
				break;
		}
		output.fog = std::clamp(output.fog, 0.0f, 1.0f);
	}
	std::array<float, 4> diffuse = { 1.0f, 1.0f, 1.0f, 1.0f };
	std::array<float, 4> specular = {};
	if (setup.hasDiffuse) {
		const DWORD color = *reinterpret_cast<const DWORD *>(source + setup.diffuseOffset);
		diffuse[0] = static_cast<float>((color >> 16) & 0xff) / 255.0f;
		diffuse[1] = static_cast<float>((color >> 8) & 0xff) / 255.0f;
		diffuse[2] = static_cast<float>(color & 0xff) / 255.0f;
		diffuse[3] = static_cast<float>((color >> 24) & 0xff) / 255.0f;
	}
	if (setup.hasSpecular) {
		const DWORD color = *reinterpret_cast<const DWORD *>(source + setup.specularOffset);
		specular[0] = static_cast<float>((color >> 16) & 0xff) / 255.0f;
		specular[1] = static_cast<float>((color >> 8) & 0xff) / 255.0f;
		specular[2] = static_cast<float>(color & 0xff) / 255.0f;
		specular[3] = static_cast<float>((color >> 24) & 0xff) / 255.0f;
		if (setup.fogFromSpecular) {
			output.fog = specular[3];
		}
	}
	std::copy(diffuse.begin(), diffuse.end(), output.color);
	if (setup.lighting) {
		auto pick = [&](VertexSetup::MaterialSource sourceKind, const float (&material)[4]) {
			std::array<float, 4> value;
			if (sourceKind == VertexSetup::MaterialSource::VertexDiffuse) value = diffuse;
			else if (sourceKind == VertexSetup::MaterialSource::VertexSpecular) value = specular;
			else value = { material[0], material[1], material[2], material[3] };
			return value;
		};
		std::array<float, 4> lightAmbient = {};
		std::array<float, 4> lightDiffuse = {};
		for (UINT index = 0; index < setup.lightCount; ++index) {
			const VertexSetup::Light &light = setup.lights[index];
			std::array<float, 3> hitDirection = {
				light.position[0] - cameraPosition[0], light.position[1] - cameraPosition[1], light.position[2] - cameraPosition[2]
			};
			const float distance = std::sqrt(hitDirection[0] * hitDirection[0] + hitDirection[1] * hitDirection[1] + hitDirection[2] * hitDirection[2]);
			if (light.type == D3DLIGHT_DIRECTIONAL) {
				hitDirection = { -light.direction[0], -light.direction[1], -light.direction[2] };
			} else if (distance > 0.0f) {
				for (float &component : hitDirection) component /= distance;
			}
			float attenuation = 1.0f;
			if (light.type != D3DLIGHT_DIRECTIONAL) {
				const float denominator = light.attenuation0 + distance * light.attenuation1 + distance * distance * light.attenuation2;
				attenuation = denominator > 0.0f ? 1.0f / denominator : std::numeric_limits<float>::max();
				if (distance > light.range) attenuation = 0.0f;
			}
			if (light.type == D3DLIGHT_SPOT) {
				const float rho = -(hitDirection[0] * light.direction[0] + hitDirection[1] * light.direction[1] + hitDirection[2] * light.direction[2]);
				const float theta = light.cosHalfTheta;
				const float phi = light.cosHalfPhi;
				float spot = 0.0f;
				if (rho > theta) spot = 1.0f;
				else if (rho > phi && theta != phi) spot = std::pow((rho - phi) / (theta - phi), light.falloff);
				attenuation *= std::clamp(spot, 0.0f, 1.0f);
			}
			const float diffuseFactor = std::clamp(
				cameraNormal[0] * hitDirection[0] + cameraNormal[1] * hitDirection[1] + cameraNormal[2] * hitDirection[2], 0.0f, 1.0f) * attenuation;
			for (int component = 0; component < 4; ++component) {
				lightAmbient[component] += light.ambient[component] * attenuation;
				lightDiffuse[component] += light.diffuse[component] * diffuseFactor;
			}
		}
		const auto materialDiffuse = pick(setup.diffuseSource, setup.materialDiffuse);
		const auto materialAmbient = pick(setup.ambientSource, setup.materialAmbient);
		const auto materialEmissive = pick(setup.emissiveSource, setup.materialEmissive);
		for (int component = 0; component < 4; ++component) {
			output.color[component] = std::clamp(
				materialEmissive[component] + materialAmbient[component] * (setup.globalAmbient[component] + lightAmbient[component]) +
				materialDiffuse[component] * lightDiffuse[component], 0.0f, 1.0f);
		}
		output.color[3] = materialDiffuse[3];
	}
	std::array<std::array<float, 2>, 4> sourceUV = {};
	for (UINT stage = 0; stage < setup.textureCount; ++stage) {
		if (setup.uvOffset[stage] + setup.uvCoordinateCount[stage] * sizeof(float) > stride) {
			break;
		}
		const float *coordinates = reinterpret_cast<const float *>(source + setup.uvOffset[stage]);
		sourceUV[stage][0] = coordinates[0];
		sourceUV[stage][1] = setup.uvCoordinateCount[stage] > 1 ? coordinates[1] : 0.0f;
	}
	for (UINT stage = 0; stage < 4; ++stage) {
		const VertexSetup::TextureStage &textureStage = setup.stages[stage];
		std::array<float, 4> coordinates = {};
		if (textureStage.cameraSpacePosition) {
			coordinates = cameraPosition;
		} else {
			const auto &selected = sourceUV[textureStage.coordinateIndex];
			coordinates = { selected[0], selected[1], 0.0f, 1.0f };
		}
		if (textureStage.hasTransform) {
			std::array<float, 4> transformed = {};
			for (int column = 0; column < 4; ++column) {
				for (int row = 0; row < 4; ++row) {
					transformed[column] += coordinates[row] * textureStage.transform->m[row][column];
				}
			}
			coordinates = transformed;
		}
		output.uv[stage][0] = coordinates[0];
		output.uv[stage][1] = coordinates[1];
	}
	return output;
}

// In a ZHWP_VERIFY_VERTEX build every vertex is also converted by the original
// per-vertex code and the two results are compared bit for bit.
CanonicalVertex WebGPUD3DDevice::convertVertexChecked(const uint8_t *source, UINT stride, const VertexSetup &setup) const
{
	const CanonicalVertex output = convertVertex(source, stride, setup);
#ifdef ZHWP_VERIFY_VERTEX
	static unsigned long long checked = 0, mismatched = 0;
	const CanonicalVertex reference = convertVertexReference(source, stride);
	++checked;
	if (std::memcmp(&output, &reference, sizeof(output)) != 0) {
		++mismatched;
		if (mismatched <= 5) {
			fprintf(stderr, "VERTEX_MISMATCH fvf=%08x shader=%d pos=(%g %g %g %g | %g %g %g %g) color=(%g %g %g %g | %g %g %g %g)\n",
				static_cast<unsigned>(m_vertexShader), setup.program ? 1 : 0,
				output.position[0], output.position[1], output.position[2], output.position[3],
				reference.position[0], reference.position[1], reference.position[2], reference.position[3],
				output.color[0], output.color[1], output.color[2], output.color[3],
				reference.color[0], reference.color[1], reference.color[2], reference.color[3]);
		}
	}
	if ((checked & 0xfffff) == 0) fprintf(stderr, "VERTEX_VERIFY checked=%llu mismatched=%llu\n", checked, mismatched);
#endif
	return output;
}

#ifdef ZHWP_VERIFY_VERTEX
CanonicalVertex WebGPUD3DDevice::convertVertexReference(const uint8_t *source, UINT stride) const
{
	const auto programmableShader = m_vertexShaders.find(m_vertexShader);
	if (programmableShader != m_vertexShaders.end()) {
		return executeVertexShader(programmableShader->second, source, stride);
	}
	CanonicalVertex output = {};
	std::fill(std::begin(output.color), std::end(output.color), 1.0f);
	output.fog = 1.0f;
	const DWORD fvf = m_vertexShader ? m_vertexShader : (m_vertexBuffer ? m_vertexBuffer->fvf() : D3DFVF_XYZ);
	const DWORD positionType = fvf & D3DFVF_POSITION_MASK;
	UINT offset = 0;
	std::array<float, 4> cameraPosition = {};
	const auto worldTransform = m_transforms.find(D3DTS_WORLD);
	const auto viewTransform = m_transforms.find(D3DTS_VIEW);
	const D3DMATRIX &worldMatrix = worldTransform == m_transforms.end() ? identityMatrix() : worldTransform->second;
	const D3DMATRIX &viewMatrix = viewTransform == m_transforms.end() ? identityMatrix() : viewTransform->second;
	auto transform = [](const std::array<float, 4> &input, const D3DMATRIX &matrix) {
		std::array<float, 4> result = {};
		for (int column = 0; column < 4; ++column) {
			for (int row = 0; row < 4; ++row) {
				result[column] += input[row] * matrix.m[row][column];
			}
		}
		return result;
	};
	if (positionType == D3DFVF_XYZRHW) {
		const float *position = reinterpret_cast<const float *>(source);
		// GeneralsX @port Codex 04/08/2026 Convert screen-space vertices against the active render-target viewport.
		output.position[0] = ((position[0] - static_cast<float>(m_viewport.X)) / static_cast<float>(m_viewport.Width)) * 2.0f - 1.0f;
		output.position[1] = 1.0f - ((position[1] - static_cast<float>(m_viewport.Y)) / static_cast<float>(m_viewport.Height)) * 2.0f;
		output.position[2] = position[2];
		output.position[3] = 1.0f;
		offset = 4 * sizeof(float);
	} else {
		std::array<float, 4> position = {
			reinterpret_cast<const float *>(source)[0],
			reinterpret_cast<const float *>(source)[1],
			reinterpret_cast<const float *>(source)[2],
			1.0f,
		};
		const auto projection = m_transforms.find(D3DTS_PROJECTION);
		position = transform(position, worldMatrix);
		cameraPosition = transform(position, viewMatrix);
		position = transform(cameraPosition, projection == m_transforms.end() ? identityMatrix() : projection->second);
		std::copy(position.begin(), position.end(), output.position);
		offset = 3 * sizeof(float);
		if (positionType >= D3DFVF_XYZB1 && positionType <= D3DFVF_XYZB5) {
			offset += ((positionType - D3DFVF_XYZB1) / 2 + 1) * sizeof(float);
		}
	}
	output.position[0] += output.position[3] / static_cast<float>(m_viewport.Width);
	output.position[1] -= output.position[3] / static_cast<float>(m_viewport.Height);
	std::array<float, 3> cameraNormal = {};
	if (fvf & D3DFVF_NORMAL) {
		const float *normal = reinterpret_cast<const float *>(source + offset);
		float worldView[3][3] = {};
		for (int row = 0; row < 3; ++row) {
			for (int column = 0; column < 3; ++column) {
				for (int index = 0; index < 3; ++index) {
					worldView[row][column] += worldMatrix.m[row][index] * viewMatrix.m[index][column];
				}
			}
		}
		const float determinant =
			worldView[0][0] * (worldView[1][1] * worldView[2][2] - worldView[1][2] * worldView[2][1]) -
			worldView[0][1] * (worldView[1][0] * worldView[2][2] - worldView[1][2] * worldView[2][0]) +
			worldView[0][2] * (worldView[1][0] * worldView[2][1] - worldView[1][1] * worldView[2][0]);
		if (std::abs(determinant) > 1.0e-20f) {
			const float inverseDeterminant = 1.0f / determinant;
			const float inverse[3][3] = {
				{ (worldView[1][1] * worldView[2][2] - worldView[1][2] * worldView[2][1]) * inverseDeterminant,
				  (worldView[0][2] * worldView[2][1] - worldView[0][1] * worldView[2][2]) * inverseDeterminant,
				  (worldView[0][1] * worldView[1][2] - worldView[0][2] * worldView[1][1]) * inverseDeterminant },
				{ (worldView[1][2] * worldView[2][0] - worldView[1][0] * worldView[2][2]) * inverseDeterminant,
				  (worldView[0][0] * worldView[2][2] - worldView[0][2] * worldView[2][0]) * inverseDeterminant,
				  (worldView[0][2] * worldView[1][0] - worldView[0][0] * worldView[1][2]) * inverseDeterminant },
				{ (worldView[1][0] * worldView[2][1] - worldView[1][1] * worldView[2][0]) * inverseDeterminant,
				  (worldView[0][1] * worldView[2][0] - worldView[0][0] * worldView[2][1]) * inverseDeterminant,
				  (worldView[0][0] * worldView[1][1] - worldView[0][1] * worldView[1][0]) * inverseDeterminant }
			};
			for (int column = 0; column < 3; ++column) {
				for (int row = 0; row < 3; ++row) {
					cameraNormal[column] += normal[row] * inverse[column][row];
				}
			}
		}
		offset += 3 * sizeof(float);
		if (m_renderStates[D3DRS_NORMALIZENORMALS] != FALSE) {
			const float length = std::sqrt(cameraNormal[0] * cameraNormal[0] + cameraNormal[1] * cameraNormal[1] + cameraNormal[2] * cameraNormal[2]);
			if (length > 0.0f) {
				for (float &component : cameraNormal) component /= length;
			}
		}
	}
	if (positionType != D3DFVF_XYZRHW && m_renderStates[D3DRS_FOGENABLE] != FALSE) {
		const DWORD fogMode = m_renderStates[D3DRS_FOGVERTEXMODE];
		const float fogDistance = m_renderStates[D3DRS_RANGEFOGENABLE] != FALSE
			? std::sqrt(cameraPosition[0] * cameraPosition[0] + cameraPosition[1] * cameraPosition[1] + cameraPosition[2] * cameraPosition[2])
			: std::abs(cameraPosition[2]);
		const float fogDensity = std::bit_cast<float>(m_renderStates[D3DRS_FOGDENSITY]);
		switch (fogMode) {
			case D3DFOG_LINEAR: {
				const float fogStart = std::bit_cast<float>(m_renderStates[D3DRS_FOGSTART]);
				const float fogEnd = std::bit_cast<float>(m_renderStates[D3DRS_FOGEND]);
				output.fog = fogEnd == fogStart ? (fogDistance <= fogEnd ? 1.0f : 0.0f)
					: (fogEnd - fogDistance) / (fogEnd - fogStart);
				break;
			}
			case D3DFOG_EXP:
				output.fog = std::exp(-fogDensity * fogDistance);
				break;
			case D3DFOG_EXP2: {
				const float densityDistance = fogDensity * fogDistance;
				output.fog = std::exp(-densityDistance * densityDistance);
				break;
			}
			default:
				break;
		}
		output.fog = std::clamp(output.fog, 0.0f, 1.0f);
	}
	if (fvf & D3DFVF_PSIZE) {
		offset += sizeof(float);
	}
	std::array<float, 4> diffuse = { 1.0f, 1.0f, 1.0f, 1.0f };
	std::array<float, 4> specular = {};
	if (fvf & D3DFVF_DIFFUSE) {
		const DWORD color = *reinterpret_cast<const DWORD *>(source + offset);
		diffuse[0] = static_cast<float>((color >> 16) & 0xff) / 255.0f;
		diffuse[1] = static_cast<float>((color >> 8) & 0xff) / 255.0f;
		diffuse[2] = static_cast<float>(color & 0xff) / 255.0f;
		diffuse[3] = static_cast<float>((color >> 24) & 0xff) / 255.0f;
		offset += sizeof(DWORD);
	}
	if (fvf & D3DFVF_SPECULAR) {
		const DWORD color = *reinterpret_cast<const DWORD *>(source + offset);
		specular[0] = static_cast<float>((color >> 16) & 0xff) / 255.0f;
		specular[1] = static_cast<float>((color >> 8) & 0xff) / 255.0f;
		specular[2] = static_cast<float>(color & 0xff) / 255.0f;
		specular[3] = static_cast<float>((color >> 24) & 0xff) / 255.0f;
		if (m_renderStates[D3DRS_FOGENABLE] != FALSE && m_renderStates[D3DRS_FOGVERTEXMODE] == D3DFOG_NONE) {
			output.fog = specular[3];
		}
		offset += sizeof(DWORD);
	}
	std::copy(diffuse.begin(), diffuse.end(), output.color);
	if (positionType != D3DFVF_XYZRHW && (fvf & D3DFVF_NORMAL) && m_renderStates[D3DRS_LIGHTING] != FALSE) {
		auto colorValue = [](const D3DCOLORVALUE &value) {
			return std::array<float, 4>{ value.r, value.g, value.b, value.a };
		};
		auto materialSource = [&](DWORD state, const D3DCOLORVALUE &material) {
			if (m_renderStates[D3DRS_COLORVERTEX] != FALSE) {
				if (state == D3DMCS_COLOR1 && (fvf & D3DFVF_DIFFUSE)) return diffuse;
				if (state == D3DMCS_COLOR2 && (fvf & D3DFVF_SPECULAR)) return specular;
			}
			return colorValue(material);
		};
		std::array<float, 4> lightAmbient = {};
		std::array<float, 4> lightDiffuse = {};
		for (DWORD index = 0; index < 8; ++index) {
			const auto enabled = m_lightEnabled.find(index);
			const auto found = m_lights.find(index);
			if (enabled == m_lightEnabled.end() || enabled->second == FALSE || found == m_lights.end()) continue;
			const D3DLIGHT8 &light = found->second;
			std::array<float, 4> position = { light.Position.x, light.Position.y, light.Position.z, 1.0f };
			std::array<float, 4> direction = { light.Direction.x, light.Direction.y, light.Direction.z, 0.0f };
			position = transform(position, viewMatrix);
			direction = transform(direction, viewMatrix);
			float directionLength = std::sqrt(direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]);
			if (directionLength > 0.0f) {
				for (int component = 0; component < 3; ++component) direction[component] /= directionLength;
			}
			std::array<float, 3> hitDirection = {
				position[0] - cameraPosition[0], position[1] - cameraPosition[1], position[2] - cameraPosition[2]
			};
			const float distance = std::sqrt(hitDirection[0] * hitDirection[0] + hitDirection[1] * hitDirection[1] + hitDirection[2] * hitDirection[2]);
			if (light.Type == D3DLIGHT_DIRECTIONAL) {
				hitDirection = { -direction[0], -direction[1], -direction[2] };
			} else if (distance > 0.0f) {
				for (float &component : hitDirection) component /= distance;
			}
			float attenuation = 1.0f;
			if (light.Type != D3DLIGHT_DIRECTIONAL) {
				const float denominator = light.Attenuation0 + distance * light.Attenuation1 + distance * distance * light.Attenuation2;
				attenuation = denominator > 0.0f ? 1.0f / denominator : std::numeric_limits<float>::max();
				if (distance > light.Range) attenuation = 0.0f;
			}
			if (light.Type == D3DLIGHT_SPOT) {
				const float rho = -(hitDirection[0] * direction[0] + hitDirection[1] * direction[1] + hitDirection[2] * direction[2]);
				const float theta = std::cos(light.Theta * 0.5f);
				const float phi = std::cos(light.Phi * 0.5f);
				float spot = 0.0f;
				if (rho > theta) spot = 1.0f;
				else if (rho > phi && theta != phi) spot = std::pow((rho - phi) / (theta - phi), light.Falloff);
				attenuation *= std::clamp(spot, 0.0f, 1.0f);
			}
			const float diffuseFactor = std::clamp(
				cameraNormal[0] * hitDirection[0] + cameraNormal[1] * hitDirection[1] + cameraNormal[2] * hitDirection[2], 0.0f, 1.0f) * attenuation;
			const auto ambient = colorValue(light.Ambient);
			const auto direct = colorValue(light.Diffuse);
			for (int component = 0; component < 4; ++component) {
				lightAmbient[component] += ambient[component] * attenuation;
				lightDiffuse[component] += direct[component] * diffuseFactor;
			}
		}
		const auto materialDiffuse = materialSource(m_renderStates[D3DRS_DIFFUSEMATERIALSOURCE], m_material.Diffuse);
		const auto materialAmbient = materialSource(m_renderStates[D3DRS_AMBIENTMATERIALSOURCE], m_material.Ambient);
		const auto materialEmissive = materialSource(m_renderStates[D3DRS_EMISSIVEMATERIALSOURCE], m_material.Emissive);
		const DWORD ambientColor = m_renderStates[D3DRS_AMBIENT];
		const std::array<float, 4> globalAmbient = {
			static_cast<float>((ambientColor >> 16) & 0xff) / 255.0f,
			static_cast<float>((ambientColor >> 8) & 0xff) / 255.0f,
			static_cast<float>(ambientColor & 0xff) / 255.0f,
			static_cast<float>((ambientColor >> 24) & 0xff) / 255.0f
		};
		for (int component = 0; component < 4; ++component) {
			output.color[component] = std::clamp(
				materialEmissive[component] + materialAmbient[component] * (globalAmbient[component] + lightAmbient[component]) +
				materialDiffuse[component] * lightDiffuse[component], 0.0f, 1.0f);
		}
		output.color[3] = materialDiffuse[3];
	}
	const UINT textureCount = (fvf & D3DFVF_TEXCOUNT_MASK) >> D3DFVF_TEXCOUNT_SHIFT;
	std::array<std::array<float, 2>, 4> sourceUV = {};
	for (UINT stage = 0; stage < std::min(textureCount, 4U); ++stage) {
		const UINT sizeBits = (fvf >> (16 + stage * 2)) & 3;
		const UINT coordinateCount = sizeBits == 0 ? 2 : sizeBits == 1 ? 3 : sizeBits == 2 ? 4 : 1;
		if (offset + coordinateCount * sizeof(float) > stride) {
			break;
		}
		const float *coordinates = reinterpret_cast<const float *>(source + offset);
		sourceUV[stage][0] = coordinates[0];
		sourceUV[stage][1] = coordinateCount > 1 ? coordinates[1] : 0.0f;
		offset += coordinateCount * sizeof(float);
	}
	for (UINT stage = 0; stage < 4; ++stage) {
		const DWORD coordinateState = m_textureStates[stage][D3DTSS_TEXCOORDINDEX];
		const DWORD generationMode = coordinateState & 0xffff0000;
		std::array<float, 4> coordinates = {};
		if (positionType != D3DFVF_XYZRHW && generationMode == D3DTSS_TCI_CAMERASPACEPOSITION) {
			coordinates = cameraPosition;
		} else {
			const UINT coordinateIndex = coordinateState & 0xffff;
			const auto &selected = sourceUV[coordinateIndex < sourceUV.size() ? coordinateIndex : 0];
			coordinates = { selected[0], selected[1], 0.0f, 1.0f };
		}
		const DWORD transformFlags = m_textureStates[stage][D3DTSS_TEXTURETRANSFORMFLAGS];
		if (transformFlags != D3DTTFF_DISABLE) {
			const auto textureTransform = m_transforms.find(static_cast<DWORD>(D3DTS_TEXTURE0) + stage);
			if (textureTransform != m_transforms.end()) {
				std::array<float, 4> transformed = {};
				for (int column = 0; column < 4; ++column) {
					for (int row = 0; row < 4; ++row) {
						transformed[column] += coordinates[row] * textureTransform->second.m[row][column];
					}
				}
				coordinates = transformed;
			}
		}
		output.uv[stage][0] = coordinates[0];
		output.uv[stage][1] = coordinates[1];
	}
	return output;
}

#endif

// Transform and lighting run on the GPU unless the page asks for the CPU path
// (?cputnl=1, or globalThis.zhwpCpuTnl = true at run time) to compare the two.
// The launcher sets the CPU path by default on Android (web/src/transform-lighting.ts).
// Read once per frame, so a frame never mixes the paths.
void WebGPUD3DDevice::updateFixedFunctionChoice()
{
#ifdef ZHWP_VERIFY_VERTEX
	// The verification build checks the CPU conversion, so it must run it.
	m_gpuFixedFunction = false;
#else
	const bool cpu = EM_ASM_INT({
		try {
			if (typeof globalThis.zhwpCpuTnl === 'undefined') {
				globalThis.zhwpCpuTnl = new URLSearchParams(location.search).get('cputnl') === '1';
			}
			return globalThis.zhwpCpuTnl ? 1 : 0;
		} catch (e) { return 0; }
	}) != 0;
	const bool gpu = m_gpuFixedFunctionReady && !cpu;
	if (gpu != m_gpuFixedFunction || !m_fixedFunctionChoiceLogged) {
		fprintf(stderr, "INFO: fixed-function transform and lighting on the %s\n", gpu ? "GPU" : "CPU");
		m_fixedFunctionChoiceLogged = true;
	}
	m_gpuFixedFunction = gpu;
#endif
}

// The GPU path covers every fixed-function draw whose vertices it can read
// straight from the application's layout; the rest stay on convertVertex.
// Bytes a declaration element reads from the vertex (CreateVertexShader).
static UINT vertexElementSize(DWORD dataType)
{
	switch (dataType) {
		case D3DVSDT_FLOAT1: return sizeof(float);
		case D3DVSDT_FLOAT2: return 2 * sizeof(float);
		case D3DVSDT_FLOAT3: return 3 * sizeof(float);
		case D3DVSDT_FLOAT4: return 4 * sizeof(float);
		case D3DVSDT_SHORT4: return 2 * sizeof(DWORD);
		default: return sizeof(DWORD);
	}
}

// Translates a vs.1.1 program into a WGSL vertex_vs entry point that does
// what executeVertexShader does per vertex; keep the two in sync. The result
// feeds the same VertexOutput as vertex_main does with the CPU's vertices.
static std::string vertexShaderWgsl(const VertexShaderProgram &program)
{
	std::string out = R"(
struct VertexOutput {
    @builtin(position) @invariant position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv0: vec2<f32>,
    @location(2) uv1: vec2<f32>,
    @location(3) uv2: vec2<f32>,
    @location(4) uv3: vec2<f32>,
    @location(5) fog: f32,
};
struct VertexShaderConstants {
    c: array<vec4<f32>, 96>,
    viewport: vec4<f32>,
};
@group(1) @binding(0) var<uniform> vs: VertexShaderConstants;
fn vs_const(index: i32) -> vec4<f32> {
    if (index >= 0 && index < 96) { return vs.c[index]; }
    return vec4<f32>(0.0);
}
struct VertexShaderInput {
)";
	std::array<int, 16> elementOfRegister;
	elementOfRegister.fill(-1);
	for (size_t index = 0; index < program.elements.size(); ++index) {
		elementOfRegister[program.elements[index].vertexRegister] = static_cast<int>(index);
	}
	bool anyInput = false;
	for (UINT reg = 0; reg < 16; ++reg) {
		if (elementOfRegister[reg] < 0) continue;
		const DWORD type = program.elements[elementOfRegister[reg]].dataType;
		const char *wgslType = type == D3DVSDT_UBYTE4 ? "vec4<u32>"
			: (type == D3DVSDT_SHORT2 || type == D3DVSDT_SHORT4) ? "vec4<i32>" : "vec4<f32>";
		out += "    @location(" + std::to_string(reg) + ") v" + std::to_string(reg) + ": " + wgslType + ",\n";
		anyInput = true;
	}
	if (!anyInput) out += "    @builtin(vertex_index) unused: u32,\n";
	out += "};\n@vertex\nfn vertex_vs(input: VertexShaderInput) -> VertexOutput {\n";
	for (UINT reg = 0; reg < 16; ++reg) {
		std::string value = "vec4<f32>(0.0)";
		if (elementOfRegister[reg] >= 0) {
			const DWORD type = program.elements[elementOfRegister[reg]].dataType;
			const std::string in = "input.v" + std::to_string(reg);
			// D3DCOLOR is B, G, R, A in memory; executeVertexShader reads it as R, G, B, A.
			value = type == D3DVSDT_D3DCOLOR ? in + ".zyxw"
				: (type == D3DVSDT_UBYTE4 || type == D3DVSDT_SHORT2 || type == D3DVSDT_SHORT4) ? "vec4<f32>(" + in + ")" : in;
		}
		out += "    let v" + std::to_string(reg) + " = " + value + ";\n";
	}
	out += "    var a0 = vec4<f32>(0.0);\n";
	for (UINT reg = 0; reg < 12; ++reg) out += "    var r" + std::to_string(reg) + " = vec4<f32>(0.0);\n";
	out += "    var oPos = vec4<f32>(0.0, 0.0, 0.0, 1.0);\n    var oFog = vec4<f32>(0.0);\n    var oPts = vec4<f32>(0.0);\n";
	out += "    var oD0 = vec4<f32>(1.0);\n    var oD1 = vec4<f32>(0.0);\n";
	for (UINT reg = 0; reg < 8; ++reg) out += "    var oT" + std::to_string(reg) + " = vec4<f32>(0.0);\n";

	auto source = [](DWORD token, int constantOffset) -> std::string {
		const DWORD type = token & D3DSP_REGTYPE_MASK;
		const UINT index = token & 0x7ff;
		std::string value = "vec4<f32>(0.0)";
		if (type == D3DSPR_TEMP && index < 12) value = "r" + std::to_string(index);
		else if (type == D3DSPR_INPUT && index < 16) value = "v" + std::to_string(index);
		else if (type == D3DSPR_CONST) {
			std::string constantIndex = std::to_string(index + constantOffset);
			if (token & D3DVS_ADDRESSMODE_MASK) constantIndex += " + i32(max(0.0, floor(a0.x + 0.5)))";
			value = "vs_const(" + constantIndex + ")";
		} else if (type == D3DSPR_ADDR) value = "a0";
		static const char components[] = "xyzw";
		std::string swizzle = ".";
		for (UINT component = 0; component < 4; ++component) {
			swizzle += components[(token >> (D3DVS_SWIZZLE_SHIFT + component * 2)) & 3];
		}
		value = "(" + value + ")" + swizzle;
		if ((token & D3DSP_SRCMOD_MASK) == D3DSPSM_NEG) value = "(-" + value + ")";
		return value;
	};
	auto destination = [](DWORD token) -> std::string {
		const DWORD type = token & D3DSP_REGTYPE_MASK;
		const UINT index = token & 0x7ff;
		if (type == D3DSPR_TEMP && index < 12) return "r" + std::to_string(index);
		if (type == D3DSPR_ADDR) return "a0";
		if (type == D3DSPR_RASTOUT && index < 3) return index == 0 ? "oPos" : index == 1 ? "oFog" : "oPts";
		if (type == D3DSPR_ATTROUT && index < 2) return "oD" + std::to_string(index);
		if (type == D3DSPR_TEXCRDOUT && index < 8) return "oT" + std::to_string(index);
		return {};
	};
	for (const VertexShaderInstruction &instruction : program.instructions) {
		const std::string first = source(instruction.sources[0], 0);
		const std::string second = instruction.sourceCount > 1 ? source(instruction.sources[1], 0) : std::string();
		const std::string third = instruction.sourceCount > 2 ? source(instruction.sources[2], 0) : std::string();
		std::string result;
		switch (instruction.opcode) {
			case D3DSIO_MOV: result = first; break;
			case D3DSIO_ADD: result = first + " + " + second; break;
			case D3DSIO_SUB: result = first + " - " + second; break;
			case D3DSIO_MUL: result = first + " * " + second; break;
			case D3DSIO_MAD: result = first + " * " + second + " + " + third; break;
			case D3DSIO_M4x4:
				result = "vec4<f32>(";
				for (int row = 0; row < 4; ++row) {
					if (row) result += ", ";
					result += "dot(" + first + ", " + source(instruction.sources[1], row) + ")";
				}
				result += ")";
				break;
			default: continue;
		}
		const std::string target = destination(instruction.destination);
		if (target.empty()) continue;
		const DWORD mask = (instruction.destination / D3DSP_WRITEMASK_0) & 15;
		if (mask == 15) {
			out += "    " + target + " = " + result + ";\n";
		} else {
			out += "    " + target + " = select(" + target + ", " + result + ", vec4<bool>(";
			for (UINT component = 0; component < 4; ++component) {
				out += component ? ", " : "";
				out += (mask >> component) & 1 ? "true" : "false";
			}
			out += "));\n";
		}
	}
	out += R"(    var output: VertexOutput;
    output.position = vec4<f32>(oPos.x + oPos.w / vs.viewport.x, oPos.y - oPos.w / vs.viewport.y, oPos.z, oPos.w);
    output.color = oD0;
    output.uv0 = oT0.xy;
    output.uv1 = oT1.xy;
    output.uv2 = oT2.xy;
    output.uv3 = oT3.xy;
    output.fog = select(oFog.x, 1.0, oFog.x == 0.0);
    return output;
}
)";
	return out;
}

// A vs.1.1 draw runs as vertex_vs when every declared input lies inside the
// vertex; executeVertexShader would skip the others, vertex fetch cannot.
bool WebGPUD3DDevice::canUseVertexShaderProgram(const VertexSetup &setup, UINT stride)
{
	if (!m_gpuFixedFunction || !setup.program || stride % 4 != 0 || !stride || stride > 2048) return false;
	for (const VertexDeclarationElement &element : setup.program->elements) {
		if (element.vertexRegister >= 16 || element.offset + vertexElementSize(element.dataType) > stride) return false;
	}
	return vertexShaderModule(*setup.program) != nullptr;
}

WGPUShaderModule WebGPUD3DDevice::vertexShaderModule(const VertexShaderProgram &program)
{
	const auto existing = m_vertexShaderModules.find(program.handle);
	if (existing != m_vertexShaderModules.end()) return existing->second;
	const std::string source = vertexShaderWgsl(program);
	WGPUShaderSourceWGSL wgsl = WGPU_SHADER_SOURCE_WGSL_INIT;
	wgsl.code = MakeStringView(source.c_str());
	WGPUShaderModuleDescriptor descriptor = WGPU_SHADER_MODULE_DESCRIPTOR_INIT;
	descriptor.nextInChain = &wgsl.chain;
	WGPUShaderModule module = wgpuDeviceCreateShaderModule(webGPUDevice(), &descriptor);
	m_vertexShaderModules.emplace(program.handle, module);
	return module;
}

bool WebGPUD3DDevice::canUseFixedFunctionShader(const VertexSetup &setup, UINT stride) const
{
	if (!m_gpuFixedFunction || setup.program || stride % 4 != 0 || stride < 3 * sizeof(float) || stride > 2048) {
		return false;
	}
	if (setup.hasNormal && setup.normalOffset + 3 * sizeof(float) > stride) return false;
	if (setup.hasDiffuse && setup.diffuseOffset + sizeof(DWORD) > stride) return false;
	if (setup.hasSpecular && setup.specularOffset + sizeof(DWORD) > stride) return false;
	for (UINT stage = 0; stage < setup.textureCount; ++stage) {
		// convertVertex stops reading coordinates at the first set past the stride.
		if (setup.uvOffset[stage] + setup.uvCoordinateCount[stage] * sizeof(float) > stride) return false;
	}
	return true;
}

bool WebGPUD3DDevice::fixedFunctionUniforms(const VertexSetup &setup, uint32_t &offset)
{
	FixedFunctionUniforms uniforms = {};
	uniforms.world = setup.world;
	uniforms.view = setup.view;
	uniforms.projection = setup.projection;
	uniforms.viewportWidth = setup.viewportWidth;
	uniforms.viewportHeight = setup.viewportHeight;
	uniforms.viewportOrigin[0] = setup.viewportX;
	uniforms.viewportOrigin[1] = setup.viewportY;
	uint32_t flags = setup.rhw ? FixedFunctionUniforms::kPretransformed : 0;
	if (setup.hasNormal) flags |= FixedFunctionUniforms::kHasNormal;
	if (setup.normalInvertible) {
		flags |= FixedFunctionUniforms::kNormalInvertible;
		for (int row = 0; row < 3; ++row) {
			for (int column = 0; column < 3; ++column) uniforms.normalInverse[row][column] = setup.normalInverse[row][column];
		}
	}
	if (setup.normalizeNormals) flags |= FixedFunctionUniforms::kNormalizeNormals;
	if (setup.fogEnabled) {
		flags |= FixedFunctionUniforms::kFogEnabled;
		if (setup.fogRange) flags |= FixedFunctionUniforms::kFogRange;
		uniforms.fogMode = setup.fogMode;
		uniforms.fogDensity = setup.fogDensity;
		uniforms.fogStart = setup.fogStart;
		uniforms.fogEnd = setup.fogEnd;
	}
	if (setup.hasDiffuse) flags |= FixedFunctionUniforms::kHasDiffuse;
	if (setup.hasSpecular) {
		flags |= FixedFunctionUniforms::kHasSpecular;
		if (setup.fogFromSpecular) flags |= FixedFunctionUniforms::kFogFromSpecular;
	}
	if (setup.lighting) {
		flags |= FixedFunctionUniforms::kLighting;
		uniforms.diffuseSource = static_cast<uint32_t>(setup.diffuseSource);
		uniforms.ambientSource = static_cast<uint32_t>(setup.ambientSource);
		uniforms.emissiveSource = static_cast<uint32_t>(setup.emissiveSource);
		std::memcpy(uniforms.materialDiffuse, setup.materialDiffuse, sizeof(uniforms.materialDiffuse));
		std::memcpy(uniforms.materialAmbient, setup.materialAmbient, sizeof(uniforms.materialAmbient));
		std::memcpy(uniforms.materialEmissive, setup.materialEmissive, sizeof(uniforms.materialEmissive));
		std::memcpy(uniforms.globalAmbient, setup.globalAmbient, sizeof(uniforms.globalAmbient));
		uniforms.lightCount = setup.lightCount;
		for (UINT index = 0; index < setup.lightCount; ++index) {
			const VertexSetup::Light &light = setup.lights[index];
			FixedFunctionUniforms::Light &out = uniforms.lights[index];
			std::memcpy(out.position, light.position, sizeof(out.position));
			std::memcpy(out.direction, light.direction, sizeof(out.direction));
			std::memcpy(out.ambient, light.ambient, sizeof(out.ambient));
			std::memcpy(out.diffuse, light.diffuse, sizeof(out.diffuse));
			out.range = light.range;
			out.attenuation0 = light.attenuation0;
			out.attenuation1 = light.attenuation1;
			out.attenuation2 = light.attenuation2;
			out.falloff = light.falloff;
			out.cosHalfTheta = light.cosHalfTheta;
			out.cosHalfPhi = light.cosHalfPhi;
			out.type = light.type;
		}
	}
	uniforms.flags = flags;
	for (UINT stage = 0; stage < 4; ++stage) {
		const VertexSetup::TextureStage &textureStage = setup.stages[stage];
		uint32_t stageFlags = textureStage.coordinateIndex << FixedFunctionUniforms::kStageCoordinateShift;
		if (textureStage.cameraSpacePosition) stageFlags |= FixedFunctionUniforms::kStageCameraSpacePosition;
		if (textureStage.hasTransform) {
			stageFlags |= FixedFunctionUniforms::kStageHasTransform;
			uniforms.textureTransform[stage] = *textureStage.transform;
		}
		uniforms.stageFlags[stage] = stageFlags;
	}
	return appendGroup1Block(&uniforms, sizeof(uniforms), offset);
}

bool WebGPUD3DDevice::vertexShaderUniforms(uint32_t &offset)
{
	VertexShaderUniforms uniforms = {};
	std::memcpy(uniforms.constants, m_vertexShaderConstants.data(), sizeof(uniforms.constants));
	uniforms.viewport[0] = static_cast<float>(m_viewport.Width);
	uniforms.viewport[1] = static_cast<float>(m_viewport.Height);
	return appendGroup1Block(&uniforms, sizeof(uniforms), offset);
}

// Adds a block to this frame's group 1 uniforms and returns its offset.
bool WebGPUD3DDevice::appendGroup1Block(const void *block, size_t size, uint32_t &offset)
{
	UploadFrame &frame = m_uploadFrames[m_activeUploadFrame];
	// Consecutive draws of one object or pass often share the whole block.
	if (frame.lastFixedFunctionOffset != SIZE_MAX && frame.lastFixedFunctionSize == size
		&& std::memcmp(frame.fixedFunction.data() + frame.lastFixedFunctionOffset, block, size) == 0) {
		offset = static_cast<uint32_t>(frame.lastFixedFunctionOffset);
		return true;
	}
	const size_t aligned = (frame.fixedFunction.size() + kUniformOffsetAlignment - 1) & ~(kUniformOffsetAlignment - 1);
	// The binding always spans kGroup1BindingSize bytes from the offset.
	if (aligned + kGroup1BindingSize > kFixedFunctionUploadCapacity) {
		return false;
	}
	frame.fixedFunction.resize(aligned + size);
	std::memcpy(frame.fixedFunction.data() + aligned, block, size);
	frame.lastFixedFunctionOffset = aligned;
	frame.lastFixedFunctionSize = size;
	offset = static_cast<uint32_t>(aligned);
	return true;
}

WGPUBuffer WebGPUD3DDevice::syncMirror(GpuBufferMirror &mirror, const uint8_t *data, size_t size, WGPUBufferUsage usage, size_t useBegin, size_t useEnd)
{
	const size_t padded = (size + 3) & ~static_cast<size_t>(3);
	if (!padded) return nullptr;
	if (!mirror.buffer) {
		WGPUBufferDescriptor descriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
		descriptor.usage = usage | WGPUBufferUsage_CopyDst;
		descriptor.size = padded;
		mirror.buffer = wgpuDeviceCreateBuffer(webGPUDevice(), &descriptor);
		if (!mirror.buffer) return nullptr;
		mirror.markDirty(0, size, 0);
	}
	mirror.source = data;
	mirror.sourceSize = size;
	if (mirror.dirty) {
		size_t dirtyBegin = mirror.dirtyBegin;
		size_t dirtyEnd = mirror.dirtyEnd;
		// Queue writes land before all of this frame's commands, so bytes an
		// earlier draw of this frame read must not change under it. The game
		// does rewrite such bytes, even under D3DLOCK_NOOVERWRITE, so the check
		// is on the ranges themselves. After DISCARD the draws so far keep the
		// old buffer and the mirror moves to a new one holding the new bytes;
		// after any other lock this draw copies its vertices instead.
		const bool overlapsUse = mirror.usedFrame == m_frameSerial
			&& std::min(dirtyEnd, size) > mirror.usedBegin && std::min(dirtyBegin, size) < mirror.usedEnd;
		if (overlapsUse && !mirror.discarded) return nullptr;
		if (overlapsUse) {
			WGPUBuffer renamed = nullptr;
			for (size_t pooled = 0; pooled < m_bufferPool.size(); ++pooled) {
				if (m_bufferPool[pooled].size == padded && m_bufferPool[pooled].usage == usage) {
					renamed = m_bufferPool[pooled].buffer;
					m_bufferPool.erase(m_bufferPool.begin() + pooled);
					break;
				}
			}
			if (!renamed) {
				WGPUBufferDescriptor descriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
				descriptor.usage = usage | WGPUBufferUsage_CopyDst;
				descriptor.size = padded;
				renamed = wgpuDeviceCreateBuffer(webGPUDevice(), &descriptor);
			}
			if (!renamed) return nullptr;
			// The old buffer still owes this frame's earlier draws their bytes.
			writeMirror(mirror);
			m_uploadFrames[m_activeUploadFrame].retiredBuffers.push_back({mirror.buffer, padded, usage});
			mirror.buffer = renamed;
			mirror.usedFrame = UINT64_MAX;
			mirror.renamed = true;
			std::vector<uint8_t>().swap(mirror.shadow);
		}
		const size_t begin = std::min(dirtyBegin, size);
		const size_t end = std::min(dirtyEnd, size);
		// Pending bytes grow only by touching ranges: bytes in a gap may
		// already have changed after an earlier draw of this frame read them.
		if (end > begin && mirror.pending && (begin > mirror.pendingEnd || end < mirror.pendingBegin)) {
			writeMirror(mirror);
		}
		if (end > begin) {
			if (!mirror.pending) {
				mirror.pending = true;
				mirror.pendingBegin = begin;
				mirror.pendingEnd = end;
				m_pendingMirrors.push_back(&mirror);
			} else {
				mirror.pendingBegin = std::min(mirror.pendingBegin, begin);
				mirror.pendingEnd = std::max(mirror.pendingEnd, end);
			}
		}
		mirror.dirty = false;
	}
	if (mirror.usedFrame != m_frameSerial) {
		mirror.usedFrame = m_frameSerial;
		mirror.usedBegin = useBegin;
		mirror.usedEnd = useEnd;
	} else {
		mirror.usedBegin = std::min(mirror.usedBegin, useBegin);
		mirror.usedEnd = std::max(mirror.usedEnd, useEnd);
	}
	return mirror.buffer;
}

// Writes the bytes syncMirror gathered for the mirror's current buffer.
void WebGPUD3DDevice::writeMirror(GpuBufferMirror &mirror)
{
	if (!mirror.pending) return;
	mirror.pending = false;
	m_pendingMirrors.erase(std::find(m_pendingMirrors.begin(), m_pendingMirrors.end(), &mirror));
	const size_t size = mirror.sourceSize;
	const size_t padded = (size + 3) & ~static_cast<size_t>(3);
	const size_t begin = std::min(mirror.pendingBegin, size) & ~static_cast<size_t>(3);
	const size_t end = std::min(padded, (std::min(mirror.pendingEnd, size) + 3) & ~static_cast<size_t>(3));
	if (end <= begin) return;
	if (mirror.lastWriteFrame != m_frameSerial) {
		mirror.lastWriteFrame = m_frameSerial;
		++mirror.writeFrames;
	}
	if (mirror.shadow.size() != padded) {
		writeMirrorRange(mirror, begin, end);
		return;
	}
	forEachChangedRun(mirror.shadow.data(), mirror.source, size, begin, end,
		[&](size_t runBegin, size_t runEnd) { writeMirrorRange(mirror, runBegin, runEnd); });
}

// Calls write(begin, end) for the runs of 256-byte blocks of [begin, end)
// whose source bytes differ from the shadow's, joined across short unchanged
// gaps (rewriting bytes the buffer already holds is harmless).
template <typename Write>
void WebGPUD3DDevice::forEachChangedRun(const uint8_t *shadow, const uint8_t *source, size_t size, size_t begin, size_t end, Write write)
{
	constexpr size_t kBlock = 256;
	constexpr size_t kJoinGap = 1024;
	size_t runBegin = SIZE_MAX;
	size_t runEnd = 0;
	for (size_t block = begin; block < end; block += kBlock) {
		const size_t blockEnd = std::min(block + kBlock, end);
		if (sameBytes(shadow + block, source, size, block, blockEnd)) continue;
		if (runBegin != SIZE_MAX && block - runEnd >= kJoinGap) {
			write(runBegin, runEnd);
			runBegin = SIZE_MAX;
		}
		if (runBegin == SIZE_MAX) runBegin = block;
		runEnd = blockEnd;
	}
	if (runBegin != SIZE_MAX) write(runBegin, runEnd);
}

// Writes bytes [0, size) of an upload frame's buffer, skipping the blocks
// that still hold the same bytes from the frame's previous use: the frame is
// reused only after the GPU finished with it (prepareUploadFrame).
void WebGPUD3DDevice::writeUpload(WGPUBuffer buffer, const uint8_t *bytes, size_t size, std::vector<uint8_t> &shadow)
{
	const size_t known = std::min(shadow.size(), size);
	if (shadow.size() < size) shadow.resize(size);
	auto write = [&](size_t begin, size_t end) {
		wgpuQueueWriteBuffer(webGPUQueue(), buffer, begin, bytes + begin, end - begin);
		std::memcpy(shadow.data() + begin, bytes + begin, end - begin);
	};
	forEachChangedRun(shadow.data(), bytes, size, 0, known, write);
	if (size > known) write(known, size);
}

// Whether shadow bytes [begin, end) equal the source's, the source read as
// zero past its size (the padding writeMirrorRange adds).
bool WebGPUD3DDevice::sameBytes(const uint8_t *shadow, const uint8_t *source, size_t size, size_t begin, size_t end)
{
	if (end > size) {
		for (size_t i = begin; i < end; ++i) {
			if (shadow[i - begin] != (i < size ? source[i] : 0)) return false;
		}
		return true;
	}
	const uint8_t *a = shadow;
	const uint8_t *b = source + begin;
	size_t n = end - begin;
	for (; n >= 8; n -= 8, a += 8, b += 8) {
		uint64_t x, y;
		std::memcpy(&x, a, 8);
		std::memcpy(&y, b, 8);
		if (x != y) return false;
	}
	return std::memcmp(a, b, n) == 0;
}

// Queues a write of mirror bytes [begin, end) (4-byte aligned, zero past the
// source's size) and records it in the shadow, if the mirror keeps one.
void WebGPUD3DDevice::writeMirrorRange(GpuBufferMirror &mirror, size_t begin, size_t end)
{
	const size_t size = mirror.sourceSize;
	const uint8_t *bytes = mirror.source + begin;
	std::vector<uint8_t> tail;
	if (end > size) {
		tail.assign(end - begin, 0);
		std::memcpy(tail.data(), mirror.source + begin, size - begin);
		bytes = tail.data();
	}
	wgpuQueueWriteBuffer(webGPUQueue(), mirror.buffer, begin, bytes, end - begin);
	if (!mirror.shadow.empty()) std::memcpy(mirror.shadow.data() + begin, bytes, end - begin);
}

void WebGPUD3DDevice::flushMirrors()
{
	while (!m_pendingMirrors.empty()) {
		GpuBufferMirror &mirror = *m_pendingMirrors.back();
		writeMirror(mirror);
		// With nothing left dirty, the buffer will hold exactly the source's
		// bytes. A buffer written in several frames starts a shadow here.
		if (mirror.shadow.empty() && !mirror.dirty && !mirror.renamed && mirror.writeFrames >= 3) {
			const size_t padded = (mirror.sourceSize + 3) & ~static_cast<size_t>(3);
			mirror.shadow.assign(padded, 0);
			std::memcpy(mirror.shadow.data(), mirror.source, mirror.sourceSize);
		}
	}
}

// Before the application changes a buffer (Lock) or frees it, the bytes its
// mirror still owes this frame's draws are written out, while they still hold
// what those draws read.
void WebGPUD3DDevice::flushMirror(GpuBufferMirror &mirror)
{
	writeMirror(mirror);
}

HRESULT WebGPUD3DDevice::encodeFixedFunctionDraw(D3DPRIMITIVETYPE type, const VertexSetup &setup, UINT stride,
	WGPUBuffer vertexBuffer, uint64_t vertexOffset, uint64_t vertexBytes,
	WGPUBuffer indexBuffer, WGPUIndexFormat indexFormat, uint64_t indexOffset, uint64_t indexBytes,
	uint32_t count, uint32_t firstIndex, int32_t baseVertex, uint32_t firstVertex, uint32_t fixedFunctionOffset)
{
	UploadFrame &frame = m_uploadFrames[m_activeUploadFrame];
	WGPURenderPipeline renderPipeline = pipeline(type, &setup, stride);
	const DrawBindings bindings = bindGroup();
	if (!renderPipeline || !bindings.group) {
		return D3DERR_DRIVERINTERNALERROR;
	}
	bindPipeline(renderPipeline, m_renderStates[D3DRS_STENCILREF] & 0xff);
	bindGroupAt(0, bindings.group, bindings.uniformOffset);
	bindGroupAt(1, frame.fixedFunctionGroup, fixedFunctionOffset);
	bindVertexBuffer(0, vertexBuffer, vertexOffset, vertexBytes);
	bindVertexBuffer(1, m_defaultAttributes, 0, 16);
	if (indexBuffer) {
		bindIndexBuffer(indexBuffer, indexFormat, indexOffset, indexBytes);
		wgpuRenderPassEncoderDrawIndexed(m_pass, count, 1, firstIndex, baseVertex, 0);
	} else {
		wgpuRenderPassEncoderDraw(m_pass, count, 1, firstVertex, 0);
	}
	return D3D_OK;
}

// List draws straight from the GPU copies of the bound buffers: no per-draw
// copy and no CPU work per vertex or index. Returns S_FALSE when the draw must
// go through draw() instead.
HRESULT WebGPUD3DDevice::drawFromMirrors(D3DPRIMITIVETYPE type, UINT count, UINT first, bool indexed, UINT minIndex, UINT vertexCount)
{
	if (!m_gpuFixedFunction || !count) return S_FALSE;
	if (type != D3DPT_TRIANGLELIST && type != D3DPT_LINELIST && type != D3DPT_POINTLIST) return S_FALSE;
	if (FAILED(ensurePass(0, 0, 1.0f, 0))) return D3DERR_INVALIDCALL;
	VertexSetup setup;
	prepareVertexSetup(setup);
	const bool programmable = setup.program != nullptr;
	if (programmable ? !canUseVertexShaderProgram(setup, m_vertexStride) : !canUseFixedFunctionShader(setup, m_vertexStride)) {
		return S_FALSE;
	}
	const bool index32 = indexed && m_indexBuffer->format() == D3DFMT_INDEX32;
	const size_t firstVertexUsed = indexed ? static_cast<size_t>(m_baseVertex) + minIndex : first;
	const size_t vertexUseBegin = firstVertexUsed * m_vertexStride;
	const size_t vertexUseEnd = vertexUseBegin + static_cast<size_t>(indexed ? vertexCount : count) * m_vertexStride;
	WGPUBuffer vertexBuffer = syncMirror(m_vertexBuffer->mirror(), m_vertexBuffer->data(), m_vertexBuffer->size(), WGPUBufferUsage_Vertex,
		vertexUseBegin, vertexUseEnd);
	if (!vertexBuffer) return S_FALSE;
	WGPUBuffer indexBuffer = nullptr;
	if (indexed) {
		const size_t indexSize = index32 ? 4 : 2;
		indexBuffer = syncMirror(m_indexBuffer->mirror(), m_indexBuffer->data(), m_indexBuffer->size(), WGPUBufferUsage_Index,
			static_cast<size_t>(first) * indexSize, (static_cast<size_t>(first) + count) * indexSize);
		if (!indexBuffer) return S_FALSE;
	}
	uint32_t fixedFunctionOffset = 0;
	if (!(programmable ? vertexShaderUniforms(fixedFunctionOffset) : fixedFunctionUniforms(setup, fixedFunctionOffset))) return S_FALSE;
	const uint64_t vertexBytes = (static_cast<uint64_t>(m_vertexBuffer->size()) + 3) & ~static_cast<uint64_t>(3);
	const uint64_t indexBytes = indexed ? ((static_cast<uint64_t>(m_indexBuffer->size()) + 3) & ~static_cast<uint64_t>(3)) : 0;
	return encodeFixedFunctionDraw(type, setup, m_vertexStride, vertexBuffer, 0, vertexBytes,
		indexBuffer, index32 ? WGPUIndexFormat_Uint32 : WGPUIndexFormat_Uint16, 0, indexBytes,
		count, indexed ? first : 0, indexed ? static_cast<int32_t>(m_baseVertex) : 0, indexed ? 0 : first, fixedFunctionOffset);
}

HRESULT WebGPUD3DDevice::draw(D3DPRIMITIVETYPE type, const void *vertexData, UINT vertexCount, UINT stride, const void *indexData, D3DFORMAT indexFormat, UINT indexCount, UINT baseVertex)
{
	if (!vertexData || !vertexCount || !stride || FAILED(ensurePass(0, 0, 1.0f, 0))) {
		return D3DERR_INVALIDCALL;
	}
	const UINT sourceCount = indexData ? indexCount : vertexCount;
	size_t expandedCount = sourceCount;
	switch (type) {
		case D3DPT_POINTLIST:
		case D3DPT_LINELIST:
		case D3DPT_TRIANGLELIST:
			break;
		case D3DPT_LINESTRIP:
			expandedCount = sourceCount > 1 ? static_cast<size_t>(sourceCount - 1) * 2 : 0;
			break;
		case D3DPT_TRIANGLESTRIP:
		case D3DPT_TRIANGLEFAN:
			expandedCount = sourceCount > 2 ? static_cast<size_t>(sourceCount - 2) * 3 : 0;
			break;
		default:
			return D3DERR_INVALIDCALL;
	}
	if (!expandedCount) return D3D_OK;
	VertexSetup vertexSetup;
	prepareVertexSetup(vertexSetup);
	UploadFrame &frame = m_uploadFrames[m_activeUploadFrame];
	const size_t vertexOffset = frame.vertices.size() * sizeof(CanonicalVertex);
	const size_t firstVertex = frame.vertices.size();
	const auto *bytes = static_cast<const uint8_t *>(vertexData);
	auto sourceIndex = [&](UINT index) -> UINT {
		if (!indexData) return index;
		if (indexFormat == D3DFMT_INDEX32) return reinterpret_cast<const uint32_t *>(indexData)[index];
		return reinterpret_cast<const uint16_t *>(indexData)[index];
	};
	auto forEachExpandedIndex = [&](auto &&append) {
		switch (type) {
			case D3DPT_POINTLIST:
			case D3DPT_LINELIST:
			case D3DPT_TRIANGLELIST:
				for (UINT index = 0; index < sourceCount; ++index) if (!append(sourceIndex(index))) return false;
				break;
			case D3DPT_LINESTRIP:
				for (UINT index = 0; index + 1 < sourceCount; ++index) {
					if (!append(sourceIndex(index)) || !append(sourceIndex(index + 1))) return false;
				}
				break;
			case D3DPT_TRIANGLESTRIP:
				for (UINT index = 0; index + 2 < sourceCount; ++index) {
					if (!append(sourceIndex(index + (index & 1)))
						|| !append(sourceIndex(index + 1 - (index & 1)))
						|| !append(sourceIndex(index + 2))) return false;
				}
				break;
			case D3DPT_TRIANGLEFAN:
				for (UINT index = 1; index + 1 < sourceCount; ++index) {
					if (!append(sourceIndex(0)) || !append(sourceIndex(index))
						|| !append(sourceIndex(index + 1))) return false;
				}
				break;
			default:
				return false;
		}
		return true;
	};
	if (canUseFixedFunctionShader(vertexSetup, stride)) {
		// GPU transform and lighting: upload the application's vertices as they
		// are and let vertex_ff do what convertVertex does on the CPU.
		const bool plainList = !indexData && (type == D3DPT_POINTLIST || type == D3DPT_LINELIST || type == D3DPT_TRIANGLELIST);
		// Each draw's vertices start on a multiple of its stride, so the whole
		// staging buffer can stay bound and the draw addresses them by index.
		const size_t rawOffset = (frame.rawVertices.size() + stride - 1) / stride * stride;
		const size_t rawBytes = static_cast<size_t>(vertexCount) * stride;
		const size_t rawIndexOffset = frame.indices.size() * sizeof(uint32_t);
		const size_t rawIndexBytes = plainList ? 0 : expandedCount * sizeof(uint32_t);
		uint32_t fixedFunctionOffset = 0;
		// Without upload space left this frame the draw falls through to the CPU path.
		if (rawOffset + rawBytes <= kRawVertexUploadCapacity && rawIndexOffset + rawIndexBytes <= kIndexUploadCapacity
			&& fixedFunctionUniforms(vertexSetup, fixedFunctionOffset)) {
			if (!plainList) {
				const size_t firstIndex = frame.indices.size();
				auto appendIndex = [&](UINT index) {
					if (index < baseVertex || index - baseVertex >= vertexCount) return false;
					frame.indices.push_back(index - baseVertex);
					return true;
				};
				if (!forEachExpandedIndex(appendIndex)) {
					frame.indices.resize(firstIndex);
					return D3DERR_INVALIDCALL;
				}
			}
			frame.rawVertices.resize(rawOffset);
			frame.rawVertices.insert(frame.rawVertices.end(), bytes, bytes + rawBytes);
			const uint32_t firstRaw = static_cast<uint32_t>(rawOffset / stride);
			return encodeFixedFunctionDraw(type, vertexSetup, stride, frame.rawVertexBuffer, 0, kRawVertexUploadCapacity,
				plainList ? nullptr : frame.indexBuffer, WGPUIndexFormat_Uint32, 0, kIndexUploadCapacity,
				static_cast<uint32_t>(expandedCount), static_cast<uint32_t>(rawIndexOffset / sizeof(uint32_t)),
				static_cast<int32_t>(firstRaw), firstRaw, fixedFunctionOffset);
		}
	}
	const size_t expandedVertexBytes = expandedCount * sizeof(CanonicalVertex);
	const size_t compactVertexBytes = static_cast<size_t>(vertexCount) * sizeof(CanonicalVertex);
	const size_t indexOffset = frame.indices.size() * sizeof(uint32_t);
	const size_t indexBytes = expandedCount * sizeof(uint32_t);
	const bool expandedFits = vertexOffset + expandedVertexBytes <= kVertexUploadCapacity;
	// An indexed draw uploads at most one vertex per index, never more than its range.
	const size_t referencedVertexBytes = std::min<size_t>(vertexCount, expandedCount) * sizeof(CanonicalVertex);
	const bool referencedFits = indexData
		&& vertexOffset + referencedVertexBytes <= kVertexUploadCapacity
		&& indexOffset + indexBytes <= kIndexUploadCapacity;
	const bool indexedFits = vertexOffset + compactVertexBytes <= kVertexUploadCapacity
		&& indexOffset + indexBytes <= kIndexUploadCapacity;
	const bool useIndices = referencedFits || (indexedFits
		&& (compactVertexBytes + indexBytes < expandedVertexBytes || !expandedFits));
	if (referencedFits) {
		if (m_remapStamp.size() < vertexCount) {
			m_remapStamp.resize(vertexCount, 0);
			m_remapSlot.resize(vertexCount);
		}
		if (++m_remapGeneration == 0) {
			std::fill(m_remapStamp.begin(), m_remapStamp.end(), 0);
			m_remapGeneration = 1;
		}
		const uint32_t generation = m_remapGeneration;
		const size_t firstIndex = frame.indices.size();
		auto appendReferenced = [&](UINT index) {
			if (index < baseVertex || index - baseVertex >= vertexCount) return false;
			const UINT local = index - baseVertex;
			if (m_remapStamp[local] != generation) {
				m_remapStamp[local] = generation;
				m_remapSlot[local] = static_cast<uint32_t>(frame.vertices.size() - firstVertex);
				frame.vertices.push_back(convertVertexChecked(bytes + static_cast<size_t>(local) * stride, stride, vertexSetup));
			}
			frame.indices.push_back(m_remapSlot[local]);
			return true;
		};
		if (!forEachExpandedIndex(appendReferenced)) {
			frame.indices.resize(firstIndex);
			frame.vertices.resize(firstVertex);
			return D3DERR_INVALIDCALL;
		}
	} else if (useIndices) {
		const size_t firstIndex = frame.indices.size();
		auto appendIndex = [&](UINT index) {
			if (index < baseVertex || index - baseVertex >= vertexCount) return false;
			frame.indices.push_back(index - baseVertex);
			return true;
		};
		if (!forEachExpandedIndex(appendIndex)) {
			frame.indices.resize(firstIndex);
			return D3DERR_INVALIDCALL;
		}
		for (UINT index = 0; index < vertexCount; ++index) {
			frame.vertices.push_back(convertVertexChecked(bytes + static_cast<size_t>(index) * stride, stride, vertexSetup));
		}
	} else {
		if (!expandedFits) return D3DERR_OUTOFVIDEOMEMORY;
		auto appendVertex = [&](UINT index) {
			if (index < baseVertex || index - baseVertex >= vertexCount) return false;
			frame.vertices.push_back(convertVertexChecked(bytes + static_cast<size_t>(index - baseVertex) * stride, stride, vertexSetup));
			return true;
		};
		if (!forEachExpandedIndex(appendVertex)) {
			frame.vertices.resize(firstVertex);
			return D3DERR_INVALIDCALL;
		}
	}
	WGPURenderPipeline renderPipeline = pipeline(type);
	const DrawBindings bindings = bindGroup();
	if (!renderPipeline || !bindings.group) {
		return D3DERR_DRIVERINTERNALERROR;
	}
	// The whole staging buffers stay bound; the draw addresses its part of them.
	bindPipeline(renderPipeline, m_renderStates[D3DRS_STENCILREF] & 0xff);
	bindGroupAt(0, bindings.group, bindings.uniformOffset);
	bindVertexBuffer(0, frame.vertexBuffer, 0, kVertexUploadCapacity);
	const uint32_t firstConverted = static_cast<uint32_t>(vertexOffset / sizeof(CanonicalVertex));
	if (useIndices) {
		bindIndexBuffer(frame.indexBuffer, WGPUIndexFormat_Uint32, 0, kIndexUploadCapacity);
		wgpuRenderPassEncoderDrawIndexed(m_pass, static_cast<uint32_t>(expandedCount), 1,
			static_cast<uint32_t>(indexOffset / sizeof(uint32_t)), static_cast<int32_t>(firstConverted), 0);
	} else {
		wgpuRenderPassEncoderDraw(m_pass, static_cast<uint32_t>(expandedCount), 1, firstConverted, 0);
	}
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::DrawPrimitive(D3DPRIMITIVETYPE type, UINT startVertex, UINT primitiveCount)
{
	if (!m_vertexBuffer || !m_vertexStride) return D3DERR_INVALIDCALL;
	const UINT count = vertexCountFor(type, primitiveCount);
	const size_t offset = static_cast<size_t>(startVertex) * m_vertexStride;
	if (offset + static_cast<size_t>(count) * m_vertexStride > m_vertexBuffer->size()) return D3DERR_INVALIDCALL;
	const HRESULT mirrored = drawFromMirrors(type, count, startVertex, false);
	if (mirrored != S_FALSE) return mirrored;
	return draw(type, m_vertexBuffer->data() + offset, count, m_vertexStride, nullptr, D3DFMT_UNKNOWN, count, 0);
}

HRESULT WebGPUD3DDevice::DrawIndexedPrimitive(D3DPRIMITIVETYPE type, UINT minIndex, UINT vertexCount, UINT startIndex, UINT primitiveCount)
{
	if (!m_vertexBuffer || !m_indexBuffer || !m_vertexStride) return D3DERR_INVALIDCALL;
	const UINT indexCount = vertexCountFor(type, primitiveCount);
	const UINT indexSize = m_indexBuffer->format() == D3DFMT_INDEX32 ? 4 : 2;
	const size_t indexOffset = static_cast<size_t>(startIndex) * indexSize;
	const size_t vertexOffset = static_cast<size_t>(m_baseVertex + minIndex) * m_vertexStride;
	if (indexOffset + static_cast<size_t>(indexCount) * indexSize > m_indexBuffer->size() ||
		vertexOffset + static_cast<size_t>(vertexCount) * m_vertexStride > m_vertexBuffer->size()) return D3DERR_INVALIDCALL;
	const HRESULT mirrored = drawFromMirrors(type, indexCount, startIndex, true, minIndex, vertexCount);
	if (mirrored != S_FALSE) return mirrored;
	return draw(type, m_vertexBuffer->data() + vertexOffset, vertexCount, m_vertexStride, m_indexBuffer->data() + indexOffset, m_indexBuffer->format(), indexCount, minIndex);
}

HRESULT WebGPUD3DDevice::DrawPrimitiveUP(D3DPRIMITIVETYPE type, UINT primitiveCount, const void *data, UINT stride)
{
	const UINT count = vertexCountFor(type, primitiveCount);
	return draw(type, data, count, stride, nullptr, D3DFMT_UNKNOWN, count, 0);
}

HRESULT WebGPUD3DDevice::DrawIndexedPrimitiveUP(D3DPRIMITIVETYPE type, UINT minVertexIndex, UINT vertexCount, UINT primitiveCount, const void *indexData, D3DFORMAT indexFormat, const void *data, UINT stride)
{
	return draw(type, data, vertexCount, stride, indexData, indexFormat, vertexCountFor(type, primitiveCount), minVertexIndex);
}

} // namespace

IDirect3D8 *CreateWebGPUDirect3D8()
{
	auto *direct3D = new WebGPUDirect3D8();
	if (!direct3D->initialize()) {
		direct3D->Release();
		return nullptr;
	}
	fprintf(stderr, "INFO: Direct3D 8 compatibility initialized with Chrome WebGPU\n");
	return direct3D;
}

bool WebGPUDeviceCanSubmitFrame()
{
	return !g_activeWebGPUDevice || g_activeWebGPUDevice->canSubmitFrame();
}

namespace
{
WebGPUD3DDevice::WebGPUD3DDevice(WebGPUDirect3D8 *parent, WebGPUContext *context, const D3DPRESENT_PARAMETERS &parameters) :
	m_parent(parent),
	m_context(context),
	m_parameters(parameters)
{
	m_parent->AddRef();
	g_activeWebGPUDevice = this;
	if (!m_parameters.BackBufferWidth) {
		m_parameters.BackBufferWidth = context->width();
	}
	if (!m_parameters.BackBufferHeight) {
		m_parameters.BackBufferHeight = context->height();
	}
	m_viewport = { 0, 0, m_parameters.BackBufferWidth, m_parameters.BackBufferHeight, 0.0f, 1.0f };
	m_material.Diffuse = { 1.0f, 1.0f, 1.0f, 1.0f };
	m_material.Ambient = m_material.Diffuse;
	m_transforms[D3DTS_WORLD] = identityMatrix();
	m_transforms[D3DTS_VIEW] = identityMatrix();
	m_transforms[D3DTS_PROJECTION] = identityMatrix();
	m_renderStates[D3DRS_ZENABLE] = D3DZB_TRUE;
	m_renderStates[D3DRS_ZWRITEENABLE] = TRUE;
	m_renderStates[D3DRS_ZFUNC] = D3DCMP_LESSEQUAL;
	m_renderStates[D3DRS_CULLMODE] = D3DCULL_CCW;
	m_renderStates[D3DRS_ALPHABLENDENABLE] = FALSE;
	m_renderStates[D3DRS_ALPHATESTENABLE] = FALSE;
	m_renderStates[D3DRS_ALPHAFUNC] = D3DCMP_ALWAYS;
	m_renderStates[D3DRS_SRCBLEND] = D3DBLEND_ONE;
	m_renderStates[D3DRS_COLORWRITEENABLE] = D3DCOLORWRITEENABLE_RED | D3DCOLORWRITEENABLE_GREEN |
		D3DCOLORWRITEENABLE_BLUE | D3DCOLORWRITEENABLE_ALPHA;
	m_renderStates[D3DRS_STENCILENABLE] = FALSE;
	m_renderStates[D3DRS_STENCILFAIL] = D3DSTENCILOP_KEEP;
	m_renderStates[D3DRS_STENCILZFAIL] = D3DSTENCILOP_KEEP;
	m_renderStates[D3DRS_STENCILPASS] = D3DSTENCILOP_KEEP;
	m_renderStates[D3DRS_STENCILFUNC] = D3DCMP_ALWAYS;
	m_renderStates[D3DRS_STENCILMASK] = 0xffffffff;
	m_renderStates[D3DRS_STENCILWRITEMASK] = 0xffffffff;
	m_renderStates[D3DRS_DESTBLEND] = D3DBLEND_ZERO;
	m_renderStates[D3DRS_TEXTUREFACTOR] = 0xffffffff;
	m_renderStates[D3DRS_LIGHTING] = TRUE;
	m_renderStates[D3DRS_SPECULARENABLE] = FALSE;
	m_renderStates[D3DRS_AMBIENT] = 0;
	m_renderStates[D3DRS_COLORVERTEX] = TRUE;
	m_renderStates[D3DRS_LOCALVIEWER] = TRUE;
	m_renderStates[D3DRS_NORMALIZENORMALS] = FALSE;
	m_renderStates[D3DRS_DIFFUSEMATERIALSOURCE] = D3DMCS_COLOR1;
	m_renderStates[D3DRS_SPECULARMATERIALSOURCE] = D3DMCS_COLOR2;
	m_renderStates[D3DRS_AMBIENTMATERIALSOURCE] = D3DMCS_MATERIAL;
	m_renderStates[D3DRS_EMISSIVEMATERIALSOURCE] = D3DMCS_MATERIAL;
	m_renderStates[D3DRS_FOGENABLE] = FALSE;
	m_renderStates[D3DRS_FOGCOLOR] = 0;
	m_renderStates[D3DRS_FOGSTART] = std::bit_cast<DWORD>(0.0f);
	m_renderStates[D3DRS_FOGEND] = std::bit_cast<DWORD>(1.0f);
	m_renderStates[D3DRS_FOGDENSITY] = std::bit_cast<DWORD>(1.0f);
	m_renderStates[D3DRS_FOGTABLEMODE] = D3DFOG_NONE;
	m_renderStates[D3DRS_FOGVERTEXMODE] = D3DFOG_NONE;
	m_renderStates[D3DRS_RANGEFOGENABLE] = FALSE;
	for (UINT stageIndex = 0; stageIndex < m_textureStates.size(); ++stageIndex) {
		auto &stage = m_textureStates[stageIndex];
		stage[D3DTSS_ADDRESSU] = D3DTADDRESS_WRAP;
		stage[D3DTSS_ADDRESSV] = D3DTADDRESS_WRAP;
		stage[D3DTSS_MAGFILTER] = D3DTEXF_POINT;
		stage[D3DTSS_MINFILTER] = D3DTEXF_POINT;
		stage[D3DTSS_MIPFILTER] = D3DTEXF_NONE;
		stage[D3DTSS_MAXANISOTROPY] = 1;
		stage[D3DTSS_COLOROP] = stageIndex == 0 ? D3DTOP_MODULATE : D3DTOP_DISABLE;
		stage[D3DTSS_COLORARG1] = D3DTA_TEXTURE;
		stage[D3DTSS_COLORARG2] = D3DTA_DIFFUSE;
		stage[D3DTSS_ALPHAOP] = stageIndex == 0 ? D3DTOP_MODULATE : D3DTOP_DISABLE;
		stage[D3DTSS_ALPHAARG1] = D3DTA_TEXTURE;
		stage[D3DTSS_ALPHAARG2] = D3DTA_DIFFUSE;
	}
}

WebGPUD3DDevice::~WebGPUD3DDevice()
{
	if (g_activeWebGPUDevice == this) {
		g_activeWebGPUDevice = nullptr;
	}
	releaseFrame();
	for (WebGPUTexture *texture : m_textures) {
		if (texture) {
			texture->Release();
		}
	}
	if (m_vertexBuffer) {
		m_vertexBuffer->Release();
	}
	if (m_indexBuffer) {
		m_indexBuffer->Release();
	}
	if (m_renderTarget) {
		m_renderTarget->Release();
	}
	if (m_depthTarget) {
		m_depthTarget->Release();
	}
	if (m_backBuffer) {
		m_backBuffer->Release();
	}
	if (m_depthSurface) {
		m_depthSurface->Release();
	}
	for (const auto &[key, pipelineObject] : m_pipelines) {
		(void)key;
		wgpuRenderPipelineRelease(pipelineObject);
	}
	for (const auto &[key, pipelineObject] : m_fixedFunctionPipelines) {
		(void)key;
		wgpuRenderPipelineRelease(pipelineObject);
	}
	for (const auto &[handle, module] : m_vertexShaderModules) {
		(void)handle;
		if (module) wgpuShaderModuleRelease(module);
	}
	if (m_depthViewSingle) {
		wgpuTextureViewRelease(m_depthViewSingle);
	}
	if (m_depthTextureSingle) {
		wgpuTextureRelease(m_depthTextureSingle);
	}
	if (m_depthView) {
		wgpuTextureViewRelease(m_depthView);
	}
	if (m_depthTexture) {
		wgpuTextureRelease(m_depthTexture);
	}
	if (m_multisampleView) {
		wgpuTextureViewRelease(m_multisampleView);
	}
	if (m_multisampleTexture) {
		wgpuTextureRelease(m_multisampleTexture);
	}
	if (m_whiteView) {
		wgpuTextureViewRelease(m_whiteView);
	}
	if (m_whiteTexture) {
		wgpuTextureRelease(m_whiteTexture);
	}
	for (const auto &[key, samplerObject] : m_samplers) {
		(void)key;
		wgpuSamplerRelease(samplerObject);
	}
	for (UploadFrame &frame : m_uploadFrames) {
		releaseUploadFrame(frame);
	}
	for (const RetiredBuffer &pooled : m_bufferPool) wgpuBufferRelease(pooled.buffer);
	m_bufferPool.clear();
	if (m_pipelineLayout) {
		wgpuPipelineLayoutRelease(m_pipelineLayout);
	}
	if (m_fixedFunctionPipelineLayout) {
		wgpuPipelineLayoutRelease(m_fixedFunctionPipelineLayout);
	}
	if (m_fixedFunctionGroupLayout) {
		wgpuBindGroupLayoutRelease(m_fixedFunctionGroupLayout);
	}
	if (m_defaultAttributes) {
		wgpuBufferRelease(m_defaultAttributes);
	}
	if (m_bindGroupLayout) {
		wgpuBindGroupLayoutRelease(m_bindGroupLayout);
	}
	if (m_shader) {
		wgpuShaderModuleRelease(m_shader);
	}
	m_parent->Release();
}

void WebGPUD3DDevice::onSubmittedWorkDone(WGPUQueueWorkDoneStatus, WGPUStringView, void *userdata1, void *userdata2)
{
	auto *device = static_cast<WebGPUD3DDevice *>(userdata1);
	static_cast<UploadFrame *>(userdata2)->busy = false;
	if (device->m_pendingSubmissions > 0) {
		--device->m_pendingSubmissions;
	}
	device->Release();
}

bool WebGPUD3DDevice::initialize()
{
	static constexpr const char *shaderSource = R"(
struct VertexInput {
    @location(0) position: vec4<f32>,
    @location(1) color: vec4<f32>,
    @location(2) uv0: vec2<f32>,
    @location(3) uv1: vec2<f32>,
    @location(4) uv2: vec2<f32>,
    @location(5) uv3: vec2<f32>,
    @location(6) fog: f32,
};

// @invariant: a mesh drawn in several passes (shadow volumes, multi-pass
// terrain) must land on exactly the same depth in every pipeline, as Direct3D
// guarantees, or stencil and depth-equal tests disagree between passes.
struct VertexOutput {
    @builtin(position) @invariant position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) uv0: vec2<f32>,
    @location(2) uv1: vec2<f32>,
    @location(3) uv2: vec2<f32>,
    @location(4) uv3: vec2<f32>,
    @location(5) fog: f32,
};

@vertex
fn vertex_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = input.position;
    output.color = input.color;
    output.uv0 = input.uv0;
    output.uv1 = input.uv1;
    output.uv2 = input.uv2;
    output.uv3 = input.uv3;
    output.fog = input.fog;
    return output;
}

// Fixed-function transform and lighting on the GPU. Mirrors
// WebGPUD3DDevice::convertVertex step for step; keep the two in sync.
struct FixedFunctionLight {
    position: vec4<f32>,
    direction: vec4<f32>,
    ambient: vec4<f32>,
    diffuse: vec4<f32>,
    range: f32,
    attenuation0: f32,
    attenuation1: f32,
    attenuation2: f32,
    falloff: f32,
    cos_half_theta: f32,
    cos_half_phi: f32,
    kind: u32,
};

struct FixedFunction {
    world: mat4x4<f32>,
    view: mat4x4<f32>,
    projection: mat4x4<f32>,
    texture_transform: array<mat4x4<f32>, 4>,
    normal_inverse: array<vec4<f32>, 3>,
    material_diffuse: vec4<f32>,
    material_ambient: vec4<f32>,
    material_emissive: vec4<f32>,
    global_ambient: vec4<f32>,
    viewport_width: f32,
    viewport_height: f32,
    fog_density: f32,
    fog_start: f32,
    fog_end: f32,
    flags: u32,
    fog_mode: u32,
    light_count: u32,
    diffuse_source: u32,
    ambient_source: u32,
    emissive_source: u32,
    padding: u32,
    stage_flags: vec4<u32>,
    viewport_origin: vec4<f32>,
    lights: array<FixedFunctionLight, 8>,
};

@group(1) @binding(0) var<uniform> ff: FixedFunction;

struct FixedFunctionInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) diffuse: vec4<f32>,
    @location(3) specular: vec4<f32>,
    @location(4) uv0: vec2<f32>,
    @location(5) uv1: vec2<f32>,
    @location(6) uv2: vec2<f32>,
    @location(7) uv3: vec2<f32>,
};

fn ff_material(source: u32, material: vec4<f32>, diffuse: vec4<f32>, specular: vec4<f32>) -> vec4<f32> {
    if (source == 1u) { return diffuse; }
    if (source == 2u) { return specular; }
    return material;
}

@vertex
fn vertex_ff(input: FixedFunctionInput) -> VertexOutput {
    var output: VertexOutput;
    let flags = ff.flags;
    var camera = vec4<f32>(0.0);
    var clip: vec4<f32>;
    if ((flags & 512u) != 0u) {
        // D3DFVF_XYZRHW: screen pixels to normalized device coordinates.
        clip = vec4<f32>(((input.position.x - ff.viewport_origin.x) / ff.viewport_width) * 2.0 - 1.0,
                         1.0 - ((input.position.y - ff.viewport_origin.y) / ff.viewport_height) * 2.0,
                         input.position.z, 1.0);
    } else {
        camera = ff.view * (ff.world * vec4<f32>(input.position, 1.0));
        clip = ff.projection * camera;
    }
    clip.x += clip.w / ff.viewport_width;
    clip.y -= clip.w / ff.viewport_height;
    output.position = clip;

    var normal = vec3<f32>(0.0);
    if ((flags & 1u) != 0u) {
        if ((flags & 2u) != 0u) {
            normal = vec3<f32>(dot(ff.normal_inverse[0].xyz, input.normal),
                               dot(ff.normal_inverse[1].xyz, input.normal),
                               dot(ff.normal_inverse[2].xyz, input.normal));
        }
        if ((flags & 4u) != 0u) {
            let normal_length = length(normal);
            if (normal_length > 0.0) { normal /= normal_length; }
        }
    }

    var fog = 1.0;
    if ((flags & 8u) != 0u) {
        let fog_distance = select(abs(camera.z), length(camera.xyz), (flags & 16u) != 0u);
        switch (ff.fog_mode) {
            case 3u: {
                if (ff.fog_end == ff.fog_start) {
                    fog = select(0.0, 1.0, fog_distance <= ff.fog_end);
                } else {
                    fog = (ff.fog_end - fog_distance) / (ff.fog_end - ff.fog_start);
                }
            }
            case 1u: { fog = exp(-ff.fog_density * fog_distance); }
            case 2u: {
                let density_distance = ff.fog_density * fog_distance;
                fog = exp(-density_distance * density_distance);
            }
            default: {}
        }
        fog = clamp(fog, 0.0, 1.0);
    }

    // Direct3D colours are B,G,R,A in memory.
    var diffuse = vec4<f32>(1.0);
    var specular = vec4<f32>(0.0);
    if ((flags & 32u) != 0u) { diffuse = input.diffuse.zyxw; }
    if ((flags & 64u) != 0u) {
        specular = input.specular.zyxw;
        if ((flags & 128u) != 0u) { fog = specular.w; }
    }
    var color = diffuse;
    if ((flags & 256u) != 0u) {
        var light_ambient = vec4<f32>(0.0);
        var light_diffuse = vec4<f32>(0.0);
        for (var index = 0u; index < ff.light_count; index++) {
            let light = ff.lights[index];
            var hit = light.position.xyz - camera.xyz;
            let light_distance = length(hit);
            if (light.kind == 3u) {
                hit = -light.direction.xyz;
            } else if (light_distance > 0.0) {
                hit /= light_distance;
            }
            var attenuation = 1.0;
            if (light.kind != 3u) {
                let denominator = light.attenuation0 + light_distance * light.attenuation1 + light_distance * light_distance * light.attenuation2;
                attenuation = select(0x1.fffffep+127f, 1.0 / denominator, denominator > 0.0);
                if (light_distance > light.range) { attenuation = 0.0; }
            }
            if (light.kind == 2u) {
                let rho = -dot(hit, light.direction.xyz);
                var spot = 0.0;
                if (rho > light.cos_half_theta) {
                    spot = 1.0;
                } else if (rho > light.cos_half_phi && light.cos_half_theta != light.cos_half_phi) {
                    spot = pow((rho - light.cos_half_phi) / (light.cos_half_theta - light.cos_half_phi), light.falloff);
                }
                attenuation *= clamp(spot, 0.0, 1.0);
            }
            let diffuse_factor = clamp(dot(normal, hit), 0.0, 1.0) * attenuation;
            light_ambient += light.ambient * attenuation;
            light_diffuse += light.diffuse * diffuse_factor;
        }
        let material_diffuse = ff_material(ff.diffuse_source, ff.material_diffuse, diffuse, specular);
        let material_ambient = ff_material(ff.ambient_source, ff.material_ambient, diffuse, specular);
        let material_emissive = ff_material(ff.emissive_source, ff.material_emissive, diffuse, specular);
        color = clamp(material_emissive + material_ambient * (ff.global_ambient + light_ambient)
            + material_diffuse * light_diffuse, vec4<f32>(0.0), vec4<f32>(1.0));
        color.a = material_diffuse.a;
    }
    output.color = color;
    output.fog = fog;

    let source_uv = array<vec2<f32>, 4>(input.uv0, input.uv1, input.uv2, input.uv3);
    var uv: array<vec2<f32>, 4>;
    for (var stage = 0u; stage < 4u; stage++) {
        let stage_flags = ff.stage_flags[stage];
        var coordinates = vec4<f32>(source_uv[(stage_flags >> 8u) & 3u], 0.0, 1.0);
        if ((stage_flags & 1u) != 0u) { coordinates = camera; }
        if ((stage_flags & 2u) != 0u) { coordinates = ff.texture_transform[stage] * coordinates; }
        uv[stage] = coordinates.xy;
    }
    output.uv0 = uv[0];
    output.uv1 = uv[1];
    output.uv2 = uv[2];
    output.uv3 = uv[3];
    return output;
}

@group(0) @binding(0) var texture_sampler0: sampler;
@group(0) @binding(1) var color_texture0: texture_2d<f32>;
@group(0) @binding(2) var texture_sampler1: sampler;
@group(0) @binding(3) var color_texture1: texture_2d<f32>;
@group(0) @binding(4) var texture_sampler2: sampler;
@group(0) @binding(5) var color_texture2: texture_2d<f32>;
@group(0) @binding(6) var texture_sampler3: sampler;
@group(0) @binding(7) var color_texture3: texture_2d<f32>;

struct TextureCombiner {
    color_op0: u32,
    color_arg10: u32,
    color_arg20: u32,
    alpha_op0: u32,
    alpha_arg10: u32,
    alpha_arg20: u32,
    color_op1: u32,
    color_arg11: u32,
    color_arg21: u32,
    alpha_op1: u32,
    alpha_arg11: u32,
    alpha_arg21: u32,
    color_op2: u32,
    color_arg12: u32,
    color_arg22: u32,
    alpha_op2: u32,
    alpha_arg12: u32,
    alpha_arg22: u32,
    color_op3: u32,
    color_arg13: u32,
    color_arg23: u32,
    alpha_op3: u32,
    alpha_arg13: u32,
    alpha_arg23: u32,
    texture_factor: vec4<f32>,
    fog_color: vec4<f32>,
    alpha_ref: f32,
    alpha_func: u32,
    alpha_test_enable: u32,
    opaque_alpha: u32,
    pixel_shader_mode: u32,
    pixel_shader_texture_count: u32,
    shader_padding0: u32,
    shader_padding1: u32,
};

@group(0) @binding(8) var<uniform> combiner: TextureCombiner;

fn texture_argument(selector: u32, texture_color: vec4<f32>, diffuse: vec4<f32>, current: vec4<f32>) -> vec4<f32> {
    var value: vec4<f32>;
    switch selector & 15u {
        case 1u: { value = current; }
        case 2u: { value = texture_color; }
        case 3u: { value = combiner.texture_factor; }
        default: { value = diffuse; }
    }
    if ((selector & 32u) != 0u) {
        value = vec4<f32>(value.a);
    }
    if ((selector & 16u) != 0u) {
        value = vec4<f32>(1.0) - value;
    }
    return value;
}

fn combine_color(op: u32, first: vec4<f32>, second: vec4<f32>, texture_color: vec4<f32>, diffuse: vec4<f32>, current: vec4<f32>) -> vec3<f32> {
    switch op {
        case 2u: { return first.rgb; }
        case 3u: { return second.rgb; }
        case 5u: { return 2.0 * first.rgb * second.rgb; }
        case 6u: { return 4.0 * first.rgb * second.rgb; }
        case 7u: { return first.rgb + second.rgb; }
        case 8u: { return first.rgb + second.rgb - vec3<f32>(0.5); }
        case 9u: { return 2.0 * (first.rgb + second.rgb - vec3<f32>(0.5)); }
        case 10u: { return first.rgb - second.rgb; }
        case 11u: { return first.rgb + second.rgb - first.rgb * second.rgb; }
        case 12u: { return mix(second.rgb, first.rgb, diffuse.a); }
        case 13u: { return mix(second.rgb, first.rgb, texture_color.a); }
        case 14u: { return mix(second.rgb, first.rgb, combiner.texture_factor.a); }
        case 15u: { return first.rgb + second.rgb * (1.0 - first.a); }
        case 16u: { return mix(second.rgb, first.rgb, current.a); }
        case 18u: { return first.rgb + second.rgb * first.a; }
        case 19u: { return first.rgb * second.a + second.rgb; }
        case 20u: { return (1.0 - first.a) * second.rgb + first.rgb; }
        case 21u: { return (1.0 - second.a) * first.rgb + second.rgb; }
        case 25u: { return first.rgb * second.rgb + current.rgb; }
        case 26u: { return mix(second.rgb, first.rgb, current.rgb); }
        default: { return first.rgb * second.rgb; }
    }
}

fn combine_alpha(op: u32, first: vec4<f32>, second: vec4<f32>, texture_color: vec4<f32>, diffuse: vec4<f32>, current: vec4<f32>) -> f32 {
    switch op {
        case 1u: { return current.a; }
        case 2u: { return first.a; }
        case 3u: { return second.a; }
        case 5u: { return 2.0 * first.a * second.a; }
        case 6u: { return 4.0 * first.a * second.a; }
        case 7u: { return first.a + second.a; }
        case 8u: { return first.a + second.a - 0.5; }
        case 9u: { return 2.0 * (first.a + second.a - 0.5); }
        case 10u: { return first.a - second.a; }
        case 11u: { return first.a + second.a - first.a * second.a; }
        case 12u: { return mix(second.a, first.a, diffuse.a); }
        case 13u: { return mix(second.a, first.a, texture_color.a); }
        case 14u: { return mix(second.a, first.a, combiner.texture_factor.a); }
        case 16u: { return mix(second.a, first.a, current.a); }
        default: { return first.a * second.a; }
    }
}

fn apply_stage(current: vec4<f32>, diffuse: vec4<f32>, texture_color: vec4<f32>, color_op: u32, color_arg1: u32, color_arg2: u32, alpha_op: u32, alpha_arg1: u32, alpha_arg2: u32) -> vec4<f32> {
    if (color_op == 1u) {
        return current;
    }
    let first = texture_argument(color_arg1, texture_color, diffuse, current);
    let second = texture_argument(color_arg2, texture_color, diffuse, current);
    let alpha_first = texture_argument(alpha_arg1, texture_color, diffuse, current);
    let alpha_second = texture_argument(alpha_arg2, texture_color, diffuse, current);
    return vec4<f32>(
        clamp(combine_color(color_op, first, second, texture_color, diffuse, current), vec3<f32>(0.0), vec3<f32>(1.0)),
        clamp(combine_alpha(alpha_op, alpha_first, alpha_second, texture_color, diffuse, current), 0.0, 1.0)
    );
}

fn alpha_compare(value: f32) -> bool {
    switch combiner.alpha_func {
        case 1u: { return false; }
        case 2u: { return value < combiner.alpha_ref; }
        case 3u: { return value == combiner.alpha_ref; }
        case 4u: { return value <= combiner.alpha_ref; }
        case 5u: { return value > combiner.alpha_ref; }
        case 6u: { return value != combiner.alpha_ref; }
        case 7u: { return value >= combiner.alpha_ref; }
        default: { return true; }
    }
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let texture0 = textureSample(color_texture0, texture_sampler0, input.uv0);
    let texture1 = textureSample(color_texture1, texture_sampler1, input.uv1);
    let texture2 = textureSample(color_texture2, texture_sampler2, input.uv2);
    let texture3 = textureSample(color_texture3, texture_sampler3, input.uv3);
    var color: vec4<f32>;
    if (combiner.pixel_shader_mode == 1u) {
        color = ((texture1 - texture0) * input.color.a + texture0) * input.color;
        if (combiner.pixel_shader_texture_count > 2u) {
            color *= texture2;
        }
        if (combiner.pixel_shader_texture_count > 3u) {
            color *= texture3;
        }
    } else if (combiner.pixel_shader_mode == 2u) {
        color = texture0 * texture1 * input.color;
        if (combiner.pixel_shader_texture_count > 2u) {
            color *= texture2;
        }
        if (combiner.pixel_shader_texture_count > 3u) {
            color *= texture3;
        }
    } else if (combiner.pixel_shader_mode == 3u) {
        color = texture1 * input.color;
        if (combiner.pixel_shader_texture_count > 2u) {
            color *= texture2;
        }
        if (combiner.pixel_shader_texture_count > 3u) {
            color *= texture3;
        }
    } else if (combiner.pixel_shader_mode == 4u) {
        color = texture0 * texture1;
        color *= texture2;
        color *= input.color;
    } else {
        color = apply_stage(input.color, input.color, texture0, combiner.color_op0, combiner.color_arg10, combiner.color_arg20, combiner.alpha_op0, combiner.alpha_arg10, combiner.alpha_arg20);
        if (combiner.color_op1 != 1u) {
            color = apply_stage(color, input.color, texture1, combiner.color_op1, combiner.color_arg11, combiner.color_arg21, combiner.alpha_op1, combiner.alpha_arg11, combiner.alpha_arg21);
            if (combiner.color_op2 != 1u) {
                color = apply_stage(color, input.color, texture2, combiner.color_op2, combiner.color_arg12, combiner.color_arg22, combiner.alpha_op2, combiner.alpha_arg12, combiner.alpha_arg22);
                if (combiner.color_op3 != 1u) {
                    color = apply_stage(color, input.color, texture3, combiner.color_op3, combiner.color_arg13, combiner.color_arg23, combiner.alpha_op3, combiner.alpha_arg13, combiner.alpha_arg23);
                }
            }
        }
    }
    if (combiner.alpha_test_enable != 0u && !alpha_compare(color.a)) {
        discard;
    }
    // GeneralsX @bugfix zhwp 18/10/2026 The terrain pixel shaders leave the blend weight (vertex alpha) in the output
    // alpha. Without blending that alpha is meaningless in D3D, but here it blacked out the cells with no blend (#95).
    if (combiner.opaque_alpha != 0u) {
        color.a = 1.0;
    }
    color = vec4<f32>(mix(combiner.fog_color.rgb, color.rgb, input.fog), color.a);
    return color;
}
)";

	WGPUShaderSourceWGSL source = WGPU_SHADER_SOURCE_WGSL_INIT;
	source.code = MakeStringView(shaderSource);
	WGPUShaderModuleDescriptor shaderDescriptor = WGPU_SHADER_MODULE_DESCRIPTOR_INIT;
	shaderDescriptor.nextInChain = &source.chain;
	m_shader = wgpuDeviceCreateShaderModule(webGPUDevice(), &shaderDescriptor);
	if (!m_shader) {
		return false;
	}

	std::array<WGPUBindGroupLayoutEntry, 9> layoutEntries = {
		WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT,
		WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT,
		WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT,
		WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT,
		WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT,
		WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT,
		WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT,
		WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT,
		WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT,
	};
	layoutEntries[0].binding = 0;
	layoutEntries[0].visibility = WGPUShaderStage_Fragment;
	layoutEntries[0].sampler.type = WGPUSamplerBindingType_Filtering;
	layoutEntries[1].binding = 1;
	layoutEntries[1].visibility = WGPUShaderStage_Fragment;
	layoutEntries[1].texture.sampleType = WGPUTextureSampleType_Float;
	layoutEntries[1].texture.viewDimension = WGPUTextureViewDimension_2D;
	layoutEntries[1].texture.multisampled = WGPU_FALSE;
	layoutEntries[2] = layoutEntries[0];
	layoutEntries[2].binding = 2;
	layoutEntries[3] = layoutEntries[1];
	layoutEntries[3].binding = 3;
	layoutEntries[4] = layoutEntries[0];
	layoutEntries[4].binding = 4;
	layoutEntries[5] = layoutEntries[1];
	layoutEntries[5].binding = 5;
	layoutEntries[6] = layoutEntries[0];
	layoutEntries[6].binding = 6;
	layoutEntries[7] = layoutEntries[1];
	layoutEntries[7].binding = 7;
	layoutEntries[8].binding = 8;
	layoutEntries[8].visibility = WGPUShaderStage_Fragment;
	layoutEntries[8].buffer.type = WGPUBufferBindingType_Uniform;
	layoutEntries[8].buffer.hasDynamicOffset = WGPU_TRUE;
	layoutEntries[8].buffer.minBindingSize = sizeof(TextureCombinerUniforms);
	WGPUBindGroupLayoutDescriptor bindGroupLayoutDescriptor = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
	bindGroupLayoutDescriptor.entryCount = layoutEntries.size();
	bindGroupLayoutDescriptor.entries = layoutEntries.data();
	m_bindGroupLayout = wgpuDeviceCreateBindGroupLayout(webGPUDevice(), &bindGroupLayoutDescriptor);
	if (!m_bindGroupLayout) {
		return false;
	}

	WGPUPipelineLayoutDescriptor pipelineLayoutDescriptor = WGPU_PIPELINE_LAYOUT_DESCRIPTOR_INIT;
	pipelineLayoutDescriptor.bindGroupLayoutCount = 1;
	pipelineLayoutDescriptor.bindGroupLayouts = &m_bindGroupLayout;
	m_pipelineLayout = wgpuDeviceCreatePipelineLayout(webGPUDevice(), &pipelineLayoutDescriptor);

	WGPUBindGroupLayoutEntry fixedFunctionEntry = WGPU_BIND_GROUP_LAYOUT_ENTRY_INIT;
	fixedFunctionEntry.binding = 0;
	fixedFunctionEntry.visibility = WGPUShaderStage_Vertex;
	fixedFunctionEntry.buffer.type = WGPUBufferBindingType_Uniform;
	fixedFunctionEntry.buffer.hasDynamicOffset = WGPU_TRUE;
	fixedFunctionEntry.buffer.minBindingSize = kGroup1BindingSize;
	WGPUBindGroupLayoutDescriptor fixedFunctionLayoutDescriptor = WGPU_BIND_GROUP_LAYOUT_DESCRIPTOR_INIT;
	fixedFunctionLayoutDescriptor.entryCount = 1;
	fixedFunctionLayoutDescriptor.entries = &fixedFunctionEntry;
	m_fixedFunctionGroupLayout = wgpuDeviceCreateBindGroupLayout(webGPUDevice(), &fixedFunctionLayoutDescriptor);
	const std::array<WGPUBindGroupLayout, 2> fixedFunctionGroupLayouts = { m_bindGroupLayout, m_fixedFunctionGroupLayout };
	WGPUPipelineLayoutDescriptor fixedFunctionPipelineDescriptor = WGPU_PIPELINE_LAYOUT_DESCRIPTOR_INIT;
	fixedFunctionPipelineDescriptor.bindGroupLayoutCount = fixedFunctionGroupLayouts.size();
	fixedFunctionPipelineDescriptor.bindGroupLayouts = fixedFunctionGroupLayouts.data();
	m_fixedFunctionPipelineLayout = wgpuDeviceCreatePipelineLayout(webGPUDevice(), &fixedFunctionPipelineDescriptor);
	WGPUBufferDescriptor defaultAttributesDescriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
	defaultAttributesDescriptor.usage = WGPUBufferUsage_Vertex | WGPUBufferUsage_CopyDst;
	defaultAttributesDescriptor.size = 16;
	m_defaultAttributes = wgpuDeviceCreateBuffer(webGPUDevice(), &defaultAttributesDescriptor);
	const std::array<uint8_t, 16> zeros = {};
	wgpuQueueWriteBuffer(webGPUQueue(), m_defaultAttributes, 0, zeros.data(), zeros.size());
	m_gpuFixedFunctionReady = m_fixedFunctionGroupLayout && m_fixedFunctionPipelineLayout && m_defaultAttributes;
	updateFixedFunctionChoice();

	for (UploadFrame &frame : m_uploadFrames) {
		WGPUBufferDescriptor vertexDescriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
		vertexDescriptor.usage = WGPUBufferUsage_Vertex | WGPUBufferUsage_CopyDst;
		vertexDescriptor.size = kVertexUploadCapacity;
		frame.vertexBuffer = wgpuDeviceCreateBuffer(webGPUDevice(), &vertexDescriptor);
		WGPUBufferDescriptor indexDescriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
		indexDescriptor.usage = WGPUBufferUsage_Index | WGPUBufferUsage_CopyDst;
		indexDescriptor.size = kIndexUploadCapacity;
		frame.indexBuffer = wgpuDeviceCreateBuffer(webGPUDevice(), &indexDescriptor);
		WGPUBufferDescriptor uniformDescriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
		uniformDescriptor.usage = WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst;
		uniformDescriptor.size = kUniformUploadCapacity;
		frame.uniformBuffer = wgpuDeviceCreateBuffer(webGPUDevice(), &uniformDescriptor);
		if (!frame.vertexBuffer || !frame.indexBuffer || !frame.uniformBuffer) {
			return false;
		}
		if (m_gpuFixedFunctionReady) {
			WGPUBufferDescriptor rawDescriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
			rawDescriptor.usage = WGPUBufferUsage_Vertex | WGPUBufferUsage_CopyDst;
			rawDescriptor.size = kRawVertexUploadCapacity;
			frame.rawVertexBuffer = wgpuDeviceCreateBuffer(webGPUDevice(), &rawDescriptor);
			WGPUBufferDescriptor fixedFunctionDescriptor = WGPU_BUFFER_DESCRIPTOR_INIT;
			fixedFunctionDescriptor.usage = WGPUBufferUsage_Uniform | WGPUBufferUsage_CopyDst;
			fixedFunctionDescriptor.size = kFixedFunctionUploadCapacity;
			frame.fixedFunctionBuffer = wgpuDeviceCreateBuffer(webGPUDevice(), &fixedFunctionDescriptor);
			WGPUBindGroupEntry fixedFunctionBinding = WGPU_BIND_GROUP_ENTRY_INIT;
			fixedFunctionBinding.binding = 0;
			fixedFunctionBinding.buffer = frame.fixedFunctionBuffer;
			fixedFunctionBinding.size = kGroup1BindingSize;
			WGPUBindGroupDescriptor fixedFunctionGroupDescriptor = WGPU_BIND_GROUP_DESCRIPTOR_INIT;
			fixedFunctionGroupDescriptor.layout = m_fixedFunctionGroupLayout;
			fixedFunctionGroupDescriptor.entryCount = 1;
			fixedFunctionGroupDescriptor.entries = &fixedFunctionBinding;
			frame.fixedFunctionGroup = frame.fixedFunctionBuffer
				? wgpuDeviceCreateBindGroup(webGPUDevice(), &fixedFunctionGroupDescriptor) : nullptr;
			if (!frame.rawVertexBuffer || !frame.fixedFunctionGroup) {
				m_gpuFixedFunctionReady = false;
				m_gpuFixedFunction = false;
			}
		}
	}

	WGPUTextureDescriptor whiteDescriptor = WGPU_TEXTURE_DESCRIPTOR_INIT;
	whiteDescriptor.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;
	whiteDescriptor.dimension = WGPUTextureDimension_2D;
	whiteDescriptor.size = { 1, 1, 1 };
	whiteDescriptor.format = WGPUTextureFormat_RGBA8Unorm;
	m_whiteTexture = wgpuDeviceCreateTexture(webGPUDevice(), &whiteDescriptor);
	m_whiteView = wgpuTextureCreateView(m_whiteTexture, nullptr);
	const std::array<uint8_t, 4> white = { 255, 255, 255, 255 };
	WGPUTexelCopyTextureInfo whiteDestination = WGPU_TEXEL_COPY_TEXTURE_INFO_INIT;
	whiteDestination.texture = m_whiteTexture;
	whiteDestination.aspect = WGPUTextureAspect_All;
	WGPUTexelCopyBufferLayout whiteLayout = WGPU_TEXEL_COPY_BUFFER_LAYOUT_INIT;
	whiteLayout.bytesPerRow = 4;
	whiteLayout.rowsPerImage = 1;
	WGPUExtent3D whiteExtent = { 1, 1, 1 };
	wgpuQueueWriteTexture(webGPUQueue(), &whiteDestination, white.data(), white.size(), &whiteLayout, &whiteExtent);

	m_backBuffer = new WebGPUSurface(this, m_parameters.BackBufferWidth, m_parameters.BackBufferHeight, m_parameters.BackBufferFormat, D3DUSAGE_RENDERTARGET, D3DPOOL_DEFAULT, false);
	m_depthSurface = new WebGPUSurface(this, m_parameters.BackBufferWidth, m_parameters.BackBufferHeight, m_parameters.AutoDepthStencilFormat, D3DUSAGE_DEPTHSTENCIL, D3DPOOL_DEFAULT, false);
	createDepthBuffer();
	return m_pipelineLayout && m_whiteTexture && m_whiteView && m_depthTexture && m_depthView;
}

HRESULT WebGPUD3DDevice::QueryInterface(REFIID, void **output)
{
	if (!output) {
		return E_POINTER;
	}
	*output = this;
	AddRef();
	return S_OK;
}

ULONG WebGPUD3DDevice::AddRef()
{
	return ++m_refs;
}

ULONG WebGPUD3DDevice::Release()
{
	const ULONG refs = --m_refs;
	if (!refs) {
		delete this;
	}
	return refs;
}

HRESULT WebGPUD3DDevice::GetDirect3D(IDirect3D8 **direct3D)
{
	return ReturnObject<IDirect3D8>(m_parent, direct3D);
}

HRESULT WebGPUD3DDevice::GetDeviceCaps(D3DCAPS8 *caps)
{
	return m_parent->GetDeviceCaps(0, m_creation.DeviceType, caps);
}

HRESULT WebGPUD3DDevice::GetDisplayMode(D3DDISPLAYMODE *mode)
{
	if (!mode) {
		return D3DERR_INVALIDCALL;
	}
	mode->Width = m_parameters.BackBufferWidth;
	mode->Height = m_parameters.BackBufferHeight;
	mode->RefreshRate = 60;
	mode->Format = m_parameters.BackBufferFormat;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetCreationParameters(D3DDEVICE_CREATION_PARAMETERS *parameters)
{
	if (!parameters) {
		return D3DERR_INVALIDCALL;
	}
	*parameters = m_creation;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::Reset(D3DPRESENT_PARAMETERS *parameters)
{
	if (!parameters) {
		return D3DERR_INVALIDCALL;
	}
	releaseFrame();
	m_parameters = *parameters;
	if (!m_parameters.BackBufferWidth) m_parameters.BackBufferWidth = m_context->width();
	if (!m_parameters.BackBufferHeight) m_parameters.BackBufferHeight = m_context->height();
	// GeneralsX @port Codex 04/08/2026 Keep the WebGPU surface and viewport aligned with Direct3D reset dimensions.
	if (!m_context->resize(m_parameters.BackBufferWidth, m_parameters.BackBufferHeight)) {
		return D3DERR_DEVICELOST;
	}
	if (m_renderTarget) {
		m_renderTarget->Release();
		m_renderTarget = nullptr;
	}
	if (m_depthTarget) {
		m_depthTarget->Release();
		m_depthTarget = nullptr;
	}
	if (m_backBuffer) {
		m_backBuffer->Release();
	}
	if (m_depthSurface) {
		m_depthSurface->Release();
	}
	m_backBuffer = new WebGPUSurface(this, m_parameters.BackBufferWidth, m_parameters.BackBufferHeight, m_parameters.BackBufferFormat, D3DUSAGE_RENDERTARGET, D3DPOOL_DEFAULT, false);
	m_depthSurface = new WebGPUSurface(this, m_parameters.BackBufferWidth, m_parameters.BackBufferHeight, m_parameters.AutoDepthStencilFormat, D3DUSAGE_DEPTHSTENCIL, D3DPOOL_DEFAULT, false);
	m_viewport = { 0, 0, m_parameters.BackBufferWidth, m_parameters.BackBufferHeight, 0.0f, 1.0f };
	createDepthBuffer();
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::Present(const RECT *, const RECT *, HWND, const RGNDATA *)
{
	if (!m_encoder && FAILED(ensurePass(D3DCLEAR_TARGET | D3DCLEAR_ZBUFFER, 0xff000000, 1.0f, 0))) {
		return D3DERR_DEVICELOST;
	}
	finishPass();
	UploadFrame &uploadFrame = m_uploadFrames[m_activeUploadFrame];
	if (!uploadFrame.vertices.empty()) {
		wgpuQueueWriteBuffer(webGPUQueue(), uploadFrame.vertexBuffer, 0, uploadFrame.vertices.data(), uploadFrame.vertices.size() * sizeof(CanonicalVertex));
	}
	if (!uploadFrame.indices.empty()) {
		wgpuQueueWriteBuffer(webGPUQueue(), uploadFrame.indexBuffer, 0, uploadFrame.indices.data(), uploadFrame.indices.size() * sizeof(uint32_t));
	}
	if (!uploadFrame.uniforms.empty()) {
		writeUpload(uploadFrame.uniformBuffer, uploadFrame.uniforms.data(), uploadFrame.uniforms.size(), uploadFrame.uniformShadow);
	}
	if (!uploadFrame.rawVertices.empty()) {
		wgpuQueueWriteBuffer(webGPUQueue(), uploadFrame.rawVertexBuffer, 0, uploadFrame.rawVertices.data(), uploadFrame.rawVertices.size());
	}
	if (!uploadFrame.fixedFunction.empty()) {
		wgpuQueueWriteBuffer(webGPUQueue(), uploadFrame.fixedFunctionBuffer, 0, uploadFrame.fixedFunction.data(), uploadFrame.fixedFunction.size());
	}
	flushMirrors();
	WGPUCommandBuffer commands = wgpuCommandEncoderFinish(m_encoder, nullptr);
	wgpuQueueSubmit(webGPUQueue(), 1, &commands);
	uploadFrame.busy = true;
	++m_pendingSubmissions;
	AddRef();
	wgpuQueueOnSubmittedWorkDone(webGPUQueue(), WGPUQueueWorkDoneCallbackInfo {
		.mode = WGPUCallbackMode_AllowSpontaneous,
		.callback = onSubmittedWorkDone,
		.userdata1 = this,
		.userdata2 = &uploadFrame,
	});
	m_nextUploadFrame = (m_activeUploadFrame + 1) % kUploadFrameCount;
	++m_frameSerial;
	updateFixedFunctionChoice();
	#if !defined(__EMSCRIPTEN__)
	// GeneralsX @port Codex 04/08/2026 Browsers present WebGPU surfaces when requestAnimationFrame returns.
	wgpuSurfacePresent(m_context->surface());
	#endif
	wgpuCommandBufferRelease(commands);
	wgpuCommandEncoderRelease(m_encoder);
	m_encoder = nullptr;
	releaseFrame();
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetBackBuffer(UINT backBuffer, D3DBACKBUFFER_TYPE, IDirect3DSurface8 **surface)
{
	if (backBuffer || !surface) {
		return D3DERR_INVALIDCALL;
	}
	return ReturnObject<IDirect3DSurface8>(m_backBuffer, surface);
}

HRESULT WebGPUD3DDevice::GetRasterStatus(D3DRASTER_STATUS *status)
{
	if (!status) {
		return D3DERR_INVALIDCALL;
	}
	status->InVBlank = FALSE;
	status->ScanLine = 0;
	return D3D_OK;
}

void WebGPUD3DDevice::GetGammaRamp(D3DGAMMARAMP *ramp)
{
	if (!ramp) {
		return;
	}
	for (UINT index = 0; index < 256; ++index) {
		const WORD value = static_cast<WORD>(index * 257);
		ramp->red[index] = value;
		ramp->green[index] = value;
		ramp->blue[index] = value;
	}
}

HRESULT WebGPUD3DDevice::CreateTexture(UINT width, UINT height, UINT levels, DWORD usage, D3DFORMAT format, D3DPOOL pool, IDirect3DTexture8 **texture)
{
	if (!width || !height || !texture) {
		return D3DERR_INVALIDCALL;
	}
	*texture = new WebGPUTexture(this, width, height, levels, usage, format, pool);
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::CreateVertexBuffer(UINT length, DWORD usage, DWORD fvf, D3DPOOL pool, IDirect3DVertexBuffer8 **buffer)
{
	if (!length || !buffer) {
		return D3DERR_INVALIDCALL;
	}
	*buffer = new WebGPUVertexBuffer(this, length, usage, fvf, pool);
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::CreateIndexBuffer(UINT length, DWORD usage, D3DFORMAT format, D3DPOOL pool, IDirect3DIndexBuffer8 **buffer)
{
	if (!length || !buffer || (format != D3DFMT_INDEX16 && format != D3DFMT_INDEX32)) {
		return D3DERR_INVALIDCALL;
	}
	*buffer = new WebGPUIndexBuffer(this, length, usage, format, pool);
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::CreateRenderTarget(UINT width, UINT height, D3DFORMAT format, D3DMULTISAMPLE_TYPE, WINBOOL, IDirect3DSurface8 **surface)
{
	if (!surface) {
		return D3DERR_INVALIDCALL;
	}
	*surface = new WebGPUSurface(this, width, height, format, D3DUSAGE_RENDERTARGET, D3DPOOL_DEFAULT);
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::CreateDepthStencilSurface(UINT width, UINT height, D3DFORMAT format, D3DMULTISAMPLE_TYPE, IDirect3DSurface8 **surface)
{
	if (!surface) {
		return D3DERR_INVALIDCALL;
	}
	*surface = new WebGPUSurface(this, width, height, format, D3DUSAGE_DEPTHSTENCIL, D3DPOOL_DEFAULT);
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::CreateImageSurface(UINT width, UINT height, D3DFORMAT format, IDirect3DSurface8 **surface)
{
	if (!surface) {
		return D3DERR_INVALIDCALL;
	}
	*surface = new WebGPUSurface(this, width, height, format, 0, D3DPOOL_SYSTEMMEM);
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::CopyRects(IDirect3DSurface8 *sourceInterface, const RECT *sourceRects, UINT rectCount, IDirect3DSurface8 *destinationInterface, const POINT *destinationPoints)
{
	auto *source = static_cast<WebGPUSurface *>(sourceInterface);
	auto *destination = static_cast<WebGPUSurface *>(destinationInterface);
	if (!source || !destination || source->format() != destination->format()) {
		return D3DERR_INVALIDCALL;
	}
	TextureLevel &sourceLevel = source->level();
	TextureLevel &destinationLevel = destination->level();
	if (!sourceRects || !rectCount) {
		destinationLevel.data = sourceLevel.data;
		destination->markDirty();
		return D3D_OK;
	}
	const UINT bytesPerPixel = sourceLevel.width ? sourceLevel.pitch / sourceLevel.width : 0;
	for (UINT rectIndex = 0; rectIndex < rectCount; ++rectIndex) {
		const RECT &sourceRect = sourceRects[rectIndex];
		const POINT destinationPoint = destinationPoints ? destinationPoints[rectIndex] : POINT { 0, 0 };
		const UINT width = static_cast<UINT>(sourceRect.right - sourceRect.left);
		const UINT height = static_cast<UINT>(sourceRect.bottom - sourceRect.top);
		for (UINT y = 0; y < height; ++y) {
			const uint8_t *sourceRow = sourceLevel.data.data() + static_cast<size_t>(sourceRect.top + y) * sourceLevel.pitch + sourceRect.left * bytesPerPixel;
			uint8_t *destinationRow = destinationLevel.data.data() + static_cast<size_t>(destinationPoint.y + y) * destinationLevel.pitch + destinationPoint.x * bytesPerPixel;
			std::memcpy(destinationRow, sourceRow, static_cast<size_t>(width) * bytesPerPixel);
		}
	}
	destination->markDirty();
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::UpdateTexture(IDirect3DBaseTexture8 *source, IDirect3DBaseTexture8 *destination)
{
	if (!source || !destination || source->GetType() != D3DRTYPE_TEXTURE || destination->GetType() != D3DRTYPE_TEXTURE) {
		return D3DERR_INVALIDCALL;
	}
	static_cast<WebGPUTexture *>(destination)->copyFrom(*static_cast<WebGPUTexture *>(source));
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetRenderTarget(IDirect3DSurface8 *renderTarget, IDirect3DSurface8 *depthStencil)
{
	finishPass();
	if (m_renderTarget) {
		m_renderTarget->Release();
	}
	m_renderTarget = static_cast<WebGPUSurface *>(renderTarget);
	if (m_renderTarget) {
		m_renderTarget->AddRef();
	}
	if (m_depthTarget) {
		m_depthTarget->Release();
	}
	// GeneralsX @bugfix zhwp 17/10/2026 Never keep a colour surface as the depth-stencil target.
	auto *depthSurface = static_cast<WebGPUSurface *>(depthStencil);
	m_depthTarget = depthSurface && depthSurface->isDepthSurface() ? depthSurface : nullptr;
	if (m_depthTarget) {
		m_depthTarget->AddRef();
	}
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetRenderTarget(IDirect3DSurface8 **renderTarget)
{
	return ReturnObject<IDirect3DSurface8>(m_renderTarget ? m_renderTarget : m_backBuffer, renderTarget);
}

HRESULT WebGPUD3DDevice::GetDepthStencilSurface(IDirect3DSurface8 **depthStencil)
{
	return ReturnObject<IDirect3DSurface8>(m_depthTarget ? m_depthTarget : m_depthSurface, depthStencil);
}

HRESULT WebGPUD3DDevice::Clear(DWORD, const D3DRECT *, DWORD flags, D3DCOLOR color, float depth, DWORD stencil)
{
	return ensurePass(flags & (D3DCLEAR_TARGET | D3DCLEAR_ZBUFFER | D3DCLEAR_STENCIL), color, depth, stencil);
}

HRESULT WebGPUD3DDevice::SetTransform(D3DTRANSFORMSTATETYPE state, const D3DMATRIX *matrix)
{
	if (!matrix) {
		return D3DERR_INVALIDCALL;
	}
	m_transforms[state] = *matrix;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetTransform(D3DTRANSFORMSTATETYPE state, D3DMATRIX *matrix)
{
	if (!matrix) {
		return D3DERR_INVALIDCALL;
	}
	const auto found = m_transforms.find(state);
	*matrix = found == m_transforms.end() ? identityMatrix() : found->second;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::MultiplyTransform(D3DTRANSFORMSTATETYPE state, const D3DMATRIX *matrix)
{
	if (!matrix) {
		return D3DERR_INVALIDCALL;
	}
	D3DMATRIX current;
	GetTransform(state, &current);
	D3DMATRIX result = {};
	for (int row = 0; row < 4; ++row) {
		for (int column = 0; column < 4; ++column) {
			for (int index = 0; index < 4; ++index) {
				result.m[row][column] += current.m[row][index] * matrix->m[index][column];
			}
		}
	}
	m_transforms[state] = result;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetViewport(const D3DVIEWPORT8 *viewport)
{
	if (!viewport) {
		return D3DERR_INVALIDCALL;
	}
	m_viewport = *viewport;
	if (m_pass) {
		wgpuRenderPassEncoderSetViewport(m_pass, static_cast<float>(viewport->X), static_cast<float>(viewport->Y), static_cast<float>(viewport->Width), static_cast<float>(viewport->Height), viewport->MinZ, viewport->MaxZ);
	}
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetViewport(D3DVIEWPORT8 *viewport)
{
	if (!viewport) {
		return D3DERR_INVALIDCALL;
	}
	*viewport = m_viewport;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetMaterial(const D3DMATERIAL8 *material)
{
	if (!material) return D3DERR_INVALIDCALL;
	m_material = *material;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetMaterial(D3DMATERIAL8 *material)
{
	if (!material) return D3DERR_INVALIDCALL;
	*material = m_material;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetLight(DWORD index, const D3DLIGHT8 *light)
{
	if (!light) return D3DERR_INVALIDCALL;
	m_lights[index] = *light;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetLight(DWORD index, D3DLIGHT8 *light)
{
	if (!light || !m_lights.contains(index)) return D3DERR_INVALIDCALL;
	*light = m_lights[index];
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::LightEnable(DWORD index, WINBOOL enable)
{
	m_lightEnabled[index] = enable;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetLightEnable(DWORD index, WINBOOL *enable)
{
	if (!enable) return D3DERR_INVALIDCALL;
	*enable = m_lightEnabled[index];
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetRenderState(D3DRENDERSTATETYPE state, DWORD value)
{
	if (static_cast<UINT>(state) >= m_renderStates.size()) return D3DERR_INVALIDCALL;
	m_renderStates[state] = value;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetRenderState(D3DRENDERSTATETYPE state, DWORD *value)
{
	if (!value || static_cast<UINT>(state) >= m_renderStates.size()) return D3DERR_INVALIDCALL;
	*value = m_renderStates[state];
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetTexture(DWORD stage, IDirect3DBaseTexture8 **texture)
{
	if (stage >= m_textures.size() || !texture) return D3DERR_INVALIDCALL;
	*texture = m_textures[stage];
	if (*texture) (*texture)->AddRef();
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetTexture(DWORD stage, IDirect3DBaseTexture8 *texture)
{
	if (stage >= m_textures.size()) return D3DERR_INVALIDCALL;
	if (texture && texture->GetType() != D3DRTYPE_TEXTURE) return D3DERR_INVALIDCALL;
	if (texture) texture->AddRef();
	if (m_textures[stage]) m_textures[stage]->Release();
	m_textures[stage] = static_cast<WebGPUTexture *>(texture);
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetTextureStageState(DWORD stage, D3DTEXTURESTAGESTATETYPE type, DWORD *value)
{
	if (!value || stage >= kTextureStageCount || static_cast<UINT>(type) >= kTextureStateCount) return D3DERR_INVALIDCALL;
	*value = m_textureStates[stage][type];
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetTextureStageState(DWORD stage, D3DTEXTURESTAGESTATETYPE type, DWORD value)
{
	if (stage >= kTextureStageCount || static_cast<UINT>(type) >= kTextureStateCount) return D3DERR_INVALIDCALL;
	m_textureStates[stage][type] = value;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::CreateVertexShader(const DWORD *declaration, const DWORD *function, DWORD *handle, DWORD)
{
	if (!declaration || !function || !handle || function[0] != D3DVS_VERSION(1, 1)) return D3DERR_INVALIDCALL;
	VertexShaderProgram program;
	UINT streamOffset = 0;
	bool hasStream = false;
	bool declarationEnded = false;
	for (UINT index = 0; index < 128; ++index) {
		const DWORD token = declaration[index];
		program.declaration.push_back(token);
		if (token == D3DVSD_END()) {
			declarationEnded = true;
			break;
		}
		const DWORD tokenType = (token & D3DVSD_TOKENTYPEMASK) >> D3DVSD_TOKENTYPESHIFT;
		if (tokenType == D3DVSD_TOKEN_STREAM) {
			if ((token & D3DVSD_STREAMTESSMASK) || (token & D3DVSD_STREAMNUMBERMASK) != 0) return D3DERR_INVALIDCALL;
			hasStream = true;
			streamOffset = 0;
			continue;
		}
		if (tokenType != D3DVSD_TOKEN_STREAMDATA || !hasStream) return D3DERR_INVALIDCALL;
		if (token & D3DVSD_DATALOADTYPEMASK) {
			streamOffset += ((token & D3DVSD_SKIPCOUNTMASK) >> D3DVSD_SKIPCOUNTSHIFT) * sizeof(DWORD);
			continue;
		}
		const DWORD dataType = (token & D3DVSD_DATATYPEMASK) >> D3DVSD_DATATYPESHIFT;
		UINT dataSize = 0;
		switch (dataType) {
			case D3DVSDT_FLOAT1: dataSize = sizeof(float); break;
			case D3DVSDT_FLOAT2: dataSize = 2 * sizeof(float); break;
			case D3DVSDT_FLOAT3: dataSize = 3 * sizeof(float); break;
			case D3DVSDT_FLOAT4: dataSize = 4 * sizeof(float); break;
			case D3DVSDT_D3DCOLOR:
			case D3DVSDT_UBYTE4:
			case D3DVSDT_SHORT2: dataSize = sizeof(DWORD); break;
			case D3DVSDT_SHORT4: dataSize = 2 * sizeof(DWORD); break;
			default: return D3DERR_INVALIDCALL;
		}
		program.elements.push_back({ token & D3DVSD_VERTEXREGMASK, dataType, streamOffset });
		streamOffset += dataSize;
	}
	if (!declarationEnded) return D3DERR_INVALIDCALL;
	program.function.push_back(function[0]);
	bool functionEnded = false;
	UINT offset = 1;
	for (UINT instructionIndex = 0; instructionIndex < 256; ++instructionIndex) {
		const DWORD token = function[offset++];
		program.function.push_back(token);
		const DWORD opcode = token & D3DSI_OPCODE_MASK;
		if (opcode == D3DSIO_END) {
			functionEnded = true;
			break;
		}
		if (opcode == D3DSIO_COMMENT) {
			const UINT commentSize = (token & D3DSI_COMMENTSIZE_MASK) >> D3DSI_COMMENTSIZE_SHIFT;
			for (UINT index = 0; index < commentSize; ++index) program.function.push_back(function[offset++]);
			continue;
		}
		UINT sourceCount = 0;
		switch (opcode) {
			case D3DSIO_MOV: sourceCount = 1; break;
			case D3DSIO_ADD:
			case D3DSIO_SUB:
			case D3DSIO_MUL:
			case D3DSIO_M4x4: sourceCount = 2; break;
			case D3DSIO_MAD: sourceCount = 3; break;
			case D3DSIO_NOP: continue;
			default: return D3DERR_INVALIDCALL;
		}
		VertexShaderInstruction instruction = { opcode, function[offset++], {}, sourceCount };
		program.function.push_back(instruction.destination);
		for (UINT sourceIndex = 0; sourceIndex < sourceCount; ++sourceIndex) {
			instruction.sources[sourceIndex] = function[offset++];
			program.function.push_back(instruction.sources[sourceIndex]);
		}
		program.instructions.push_back(instruction);
	}
	if (!functionEnded) return D3DERR_INVALIDCALL;
	const DWORD shaderHandle = 0x80000000u | m_nextVertexShader++;
	program.handle = shaderHandle;
	m_vertexShaders.emplace(shaderHandle, std::move(program));
	*handle = shaderHandle;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetVertexShader(DWORD handle)
{
	if ((handle & 0x80000000u) && !m_vertexShaders.contains(handle)) return D3DERR_INVALIDCALL;
	m_vertexShader = handle;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::DeleteVertexShader(DWORD handle)
{
	if (!m_vertexShaders.erase(handle)) return D3DERR_INVALIDCALL;
	if (m_vertexShader == handle) m_vertexShader = D3DFVF_XYZ;
	const auto module = m_vertexShaderModules.find(handle);
	if (module != m_vertexShaderModules.end()) {
		if (module->second) wgpuShaderModuleRelease(module->second);
		m_vertexShaderModules.erase(module);
	}
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetVertexShaderConstant(DWORD startRegister, const void *data, DWORD count)
{
	if (!data || startRegister + count > m_vertexShaderConstants.size()) return D3DERR_INVALIDCALL;
	std::memcpy(m_vertexShaderConstants.data() + startRegister, data, count * sizeof(m_vertexShaderConstants[0]));
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetVertexShaderConstant(DWORD startRegister, void *data, DWORD count)
{
	if (!data || startRegister + count > m_vertexShaderConstants.size()) return D3DERR_INVALIDCALL;
	std::memcpy(data, m_vertexShaderConstants.data() + startRegister, count * sizeof(m_vertexShaderConstants[0]));
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetVertexShaderDeclaration(DWORD handle, void *data, DWORD *size)
{
	const auto found = m_vertexShaders.find(handle);
	if (found == m_vertexShaders.end() || !size) return D3DERR_INVALIDCALL;
	const DWORD requiredSize = found->second.declaration.size() * sizeof(DWORD);
	if (!data) {
		*size = requiredSize;
		return D3D_OK;
	}
	if (*size < requiredSize) {
		*size = requiredSize;
		return D3DERR_MOREDATA;
	}
	std::memcpy(data, found->second.declaration.data(), requiredSize);
	*size = requiredSize;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetVertexShaderFunction(DWORD handle, void *data, DWORD *size)
{
	const auto found = m_vertexShaders.find(handle);
	if (found == m_vertexShaders.end() || !size) return D3DERR_INVALIDCALL;
	const DWORD requiredSize = found->second.function.size() * sizeof(DWORD);
	if (!data) {
		*size = requiredSize;
		return D3D_OK;
	}
	if (*size < requiredSize) {
		*size = requiredSize;
		return D3DERR_MOREDATA;
	}
	std::memcpy(data, found->second.function.data(), requiredSize);
	*size = requiredSize;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetStreamSource(UINT stream, IDirect3DVertexBuffer8 *buffer, UINT stride)
{
	if (stream) return D3DERR_INVALIDCALL;
	if (buffer) buffer->AddRef();
	if (m_vertexBuffer) m_vertexBuffer->Release();
	m_vertexBuffer = static_cast<WebGPUVertexBuffer *>(buffer);
	m_vertexStride = stride;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetStreamSource(UINT stream, IDirect3DVertexBuffer8 **buffer, UINT *stride)
{
	if (stream || !buffer || !stride) return D3DERR_INVALIDCALL;
	*buffer = m_vertexBuffer;
	if (*buffer) (*buffer)->AddRef();
	*stride = m_vertexStride;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetIndices(IDirect3DIndexBuffer8 *indices, UINT baseVertexIndex)
{
	if (indices) indices->AddRef();
	if (m_indexBuffer) m_indexBuffer->Release();
	m_indexBuffer = static_cast<WebGPUIndexBuffer *>(indices);
	m_baseVertex = baseVertexIndex;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::GetIndices(IDirect3DIndexBuffer8 **indices, UINT *baseVertexIndex)
{
	if (!indices || !baseVertexIndex) return D3DERR_INVALIDCALL;
	*indices = m_indexBuffer;
	if (*indices) (*indices)->AddRef();
	*baseVertexIndex = m_baseVertex;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::CreatePixelShader(const DWORD *function, DWORD *handle)
{
	if (!function || !handle || function[0] != D3DPS_VERSION(1, 1)) {
		return D3DERR_INVALIDCALL;
	}
	*handle = 0;
	std::vector<DWORD> textureRegisters;
	std::vector<PixelShaderInstruction> instructions;
	UINT offset = 1;
	bool ended = false;
	for (UINT instructionIndex = 0; instructionIndex < 64; ++instructionIndex) {
		const DWORD token = function[offset++];
		const DWORD opcode = token & D3DSI_OPCODE_MASK;
		if (opcode == D3DSIO_END) {
			ended = true;
			break;
		}
		if (opcode == D3DSIO_COMMENT) {
			offset += (token & D3DSI_COMMENTSIZE_MASK) >> D3DSI_COMMENTSIZE_SHIFT;
			continue;
		}
		if (opcode == D3DSIO_TEX) {
			if (!instructions.empty()) {
				return D3DERR_INVALIDCALL;
			}
			const DWORD destination = function[offset++];
			if ((destination & D3DSP_REGTYPE_MASK) != D3DSPR_TEXTURE ||
				(destination & D3DSP_WRITEMASK_ALL) != D3DSP_WRITEMASK_ALL) {
				return D3DERR_INVALIDCALL;
			}
			const DWORD textureRegister = destination & 0x7ff;
			if (textureRegister > 3) {
				return D3DERR_INVALIDCALL;
			}
			textureRegisters.push_back(textureRegister);
			continue;
		}
		UINT parameterCount = 0;
		switch (opcode) {
			case D3DSIO_MOV: parameterCount = 2; break;
			case D3DSIO_MUL: parameterCount = 3; break;
			case D3DSIO_LRP: parameterCount = 4; break;
			default: return D3DERR_INVALIDCALL;
		}
		PixelShaderInstruction instruction = { opcode, {}, parameterCount };
		for (UINT parameter = 0; parameter < parameterCount; ++parameter) {
			instruction.parameters[parameter] = function[offset++];
		}
		instructions.push_back(instruction);
	}
	if (!ended || textureRegisters.empty()) {
		return D3DERR_INVALIDCALL;
	}

	constexpr DWORD r0Destination = 0x800f0000;
	constexpr DWORD r0 = 0x80e40000;
	constexpr DWORD diffuse = 0x90e40000;
	constexpr DWORD diffuseAlpha = 0x90ff0000;
	auto texture = [](DWORD stage) { return 0xb0e40000 | stage; };
	auto matches = [](const PixelShaderInstruction &instruction, DWORD opcode,
		const std::array<DWORD, 4> &parameters, UINT parameterCount) {
		if (instruction.opcode != opcode || instruction.parameterCount != parameterCount) {
			return false;
		}
		return std::equal(parameters.begin(), parameters.begin() + parameterCount, instruction.parameters.begin());
	};
	auto hasSequentialTextures = [&]() {
		if (textureRegisters.size() < 2 || textureRegisters.size() > 4) {
			return false;
		}
		for (UINT stage = 0; stage < textureRegisters.size(); ++stage) {
			if (textureRegisters[stage] != stage) {
				return false;
			}
		}
		return true;
	};
	auto hasMultiplicationTail = [&](UINT firstTextureStage) {
		for (UINT stage = firstTextureStage; stage < textureRegisters.size(); ++stage) {
			if (!matches(instructions[stage], D3DSIO_MUL, { r0Destination, r0, texture(stage), 0 }, 3)) {
				return false;
			}
		}
		return true;
	};

	PixelShaderProgram program = {};
	if (hasSequentialTextures() && instructions.size() == textureRegisters.size() &&
		matches(instructions[0], D3DSIO_LRP, { r0Destination, diffuseAlpha, texture(1), texture(0) }, 4) &&
		matches(instructions[1], D3DSIO_MUL, { r0Destination, r0, diffuse, 0 }, 3) &&
		hasMultiplicationTail(2)) {
		program = { 1, static_cast<DWORD>(textureRegisters.size()) };
	} else if (hasSequentialTextures() && instructions.size() == textureRegisters.size() &&
		matches(instructions[0], D3DSIO_MUL, { r0Destination, texture(1), texture(0), 0 }, 3) &&
		matches(instructions[1], D3DSIO_MUL, { r0Destination, r0, diffuse, 0 }, 3) &&
		hasMultiplicationTail(2)) {
		program = { 2, static_cast<DWORD>(textureRegisters.size()) };
	} else if (textureRegisters == std::vector<DWORD>{ 1 } && instructions.size() == 2 &&
		matches(instructions[0], D3DSIO_MOV, { r0Destination, texture(1), 0, 0 }, 2) &&
		matches(instructions[1], D3DSIO_MUL, { r0Destination, r0, diffuse, 0 }, 3)) {
		program = { 3, 2 };
	} else if (textureRegisters == std::vector<DWORD>({ 0, 1, 2 }) && instructions.size() == 3 &&
		matches(instructions[0], D3DSIO_MUL, { r0Destination, texture(0), texture(1), 0 }, 3) &&
		matches(instructions[1], D3DSIO_MUL, { r0Destination, r0, texture(2), 0 }, 3) &&
		matches(instructions[2], D3DSIO_MUL, { r0Destination, r0, diffuse, 0 }, 3)) {
		program = { 4, 3 };
	} else {
		return D3DERR_INVALIDCALL;
	}

	while (!m_nextPixelShader || m_pixelShaders.contains(m_nextPixelShader)) {
		++m_nextPixelShader;
	}
	*handle = m_nextPixelShader++;
	m_pixelShaders.emplace(*handle, program);
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::SetPixelShader(DWORD handle)
{
	if (handle && !m_pixelShaders.contains(handle)) {
		return D3DERR_INVALIDCALL;
	}
	m_pixelShader = handle;
	return D3D_OK;
}

HRESULT WebGPUD3DDevice::DeletePixelShader(DWORD handle)
{
	if (!handle || !m_pixelShaders.erase(handle)) {
		return D3DERR_INVALIDCALL;
	}
	if (m_pixelShader == handle) {
		m_pixelShader = 0;
	}
	return D3D_OK;
}

} // namespace

namespace
{
WebGPUVertexBuffer::WebGPUVertexBuffer(WebGPUD3DDevice *device, UINT length, DWORD usage, DWORD fvf, D3DPOOL pool) :
	m_device(device),
	m_data(length),
	m_usage(usage),
	m_fvf(fvf),
	m_pool(pool)
{
	m_device->AddRef();
}

WebGPUVertexBuffer::~WebGPUVertexBuffer()
{
	m_device->flushMirror(m_mirror);
	m_device->Release();
}

HRESULT WebGPUVertexBuffer::QueryInterface(REFIID, void **output)
{
	if (!output) {
		return E_POINTER;
	}
	*output = this;
	AddRef();
	return S_OK;
}

ULONG WebGPUVertexBuffer::AddRef()
{
	return ++m_refs;
}

ULONG WebGPUVertexBuffer::Release()
{
	const ULONG refs = --m_refs;
	if (!refs) {
		delete this;
	}
	return refs;
}

HRESULT WebGPUVertexBuffer::GetDevice(IDirect3DDevice8 **device)
{
	return ReturnObject<IDirect3DDevice8>(m_device, device);
}

HRESULT WebGPUVertexBuffer::Lock(UINT offset, UINT size, BYTE **data, DWORD flags)
{
	if (!data || offset > m_data.size() || (size && static_cast<size_t>(offset) + size > m_data.size())) {
		return D3DERR_INVALIDCALL;
	}
	*data = m_data.data() + offset;
	const size_t end = size ? static_cast<size_t>(offset) + size : m_data.size();
	if (m_mirror.pendingOverlaps(offset, end)) m_device->flushMirror(m_mirror);
	m_mirror.markDirty(offset, end, flags);
	return D3D_OK;
}

HRESULT WebGPUVertexBuffer::GetDesc(D3DVERTEXBUFFER_DESC *desc)
{
	if (!desc) {
		return D3DERR_INVALIDCALL;
	}
	*desc = {};
	desc->Format = D3DFMT_VERTEXDATA;
	desc->Type = D3DRTYPE_VERTEXBUFFER;
	desc->Usage = m_usage;
	desc->Pool = m_pool;
	desc->Size = static_cast<UINT>(m_data.size());
	desc->FVF = m_fvf;
	return D3D_OK;
}

WebGPUIndexBuffer::WebGPUIndexBuffer(WebGPUD3DDevice *device, UINT length, DWORD usage, D3DFORMAT format, D3DPOOL pool) :
	m_device(device),
	m_data(length),
	m_usage(usage),
	m_format(format),
	m_pool(pool)
{
	m_device->AddRef();
}

WebGPUIndexBuffer::~WebGPUIndexBuffer()
{
	m_device->flushMirror(m_mirror);
	m_device->Release();
}

HRESULT WebGPUIndexBuffer::QueryInterface(REFIID, void **output)
{
	if (!output) {
		return E_POINTER;
	}
	*output = this;
	AddRef();
	return S_OK;
}

ULONG WebGPUIndexBuffer::AddRef()
{
	return ++m_refs;
}

ULONG WebGPUIndexBuffer::Release()
{
	const ULONG refs = --m_refs;
	if (!refs) {
		delete this;
	}
	return refs;
}

HRESULT WebGPUIndexBuffer::GetDevice(IDirect3DDevice8 **device)
{
	return ReturnObject<IDirect3DDevice8>(m_device, device);
}

HRESULT WebGPUIndexBuffer::Lock(UINT offset, UINT size, BYTE **data, DWORD flags)
{
	if (!data || offset > m_data.size() || (size && static_cast<size_t>(offset) + size > m_data.size())) {
		return D3DERR_INVALIDCALL;
	}
	*data = m_data.data() + offset;
	const size_t end = size ? static_cast<size_t>(offset) + size : m_data.size();
	if (m_mirror.pendingOverlaps(offset, end)) m_device->flushMirror(m_mirror);
	m_mirror.markDirty(offset, end, flags);
	return D3D_OK;
}

HRESULT WebGPUIndexBuffer::GetDesc(D3DINDEXBUFFER_DESC *desc)
{
	if (!desc) {
		return D3DERR_INVALIDCALL;
	}
	*desc = {};
	desc->Format = m_format;
	desc->Type = D3DRTYPE_INDEXBUFFER;
	desc->Usage = m_usage;
	desc->Pool = m_pool;
	desc->Size = static_cast<UINT>(m_data.size());
	return D3D_OK;
}

WebGPUTexture::WebGPUTexture(WebGPUD3DDevice *device, UINT width, UINT height, UINT levels, DWORD usage, D3DFORMAT format, D3DPOOL pool) :
	m_device(device),
	m_usage(usage),
	m_format(format),
	m_pool(pool)
{
	m_device->AddRef();
	if (!levels) {
		levels = 1;
		for (UINT extent = std::max(width, height); extent > 1; extent >>= 1) {
			++levels;
		}
	}
	m_levels.reserve(levels);
	for (UINT level = 0; level < levels; ++level) {
		TextureLevel storage;
		storage.width = std::max(1U, width >> level);
		storage.height = std::max(1U, height >> level);
		storage.pitch = FormatRowPitch(format, storage.width);
		storage.data.resize(static_cast<size_t>(storage.pitch) * FormatRowCount(format, storage.height));
		m_levels.push_back(std::move(storage));
	}
}

WebGPUTexture::~WebGPUTexture()
{
	if (m_view) {
		m_device->forgetTextureView(m_view);
		wgpuTextureViewRelease(m_view);
	}
	if (m_texture) {
		wgpuTextureRelease(m_texture);
	}
	m_device->Release();
}

HRESULT WebGPUTexture::QueryInterface(REFIID, void **output)
{
	if (!output) {
		return E_POINTER;
	}
	*output = this;
	AddRef();
	return S_OK;
}

ULONG WebGPUTexture::AddRef()
{
	return ++m_refs;
}

ULONG WebGPUTexture::Release()
{
	const ULONG refs = --m_refs;
	if (!refs) {
		delete this;
	}
	return refs;
}

HRESULT WebGPUTexture::GetDevice(IDirect3DDevice8 **device)
{
	return ReturnObject<IDirect3DDevice8>(m_device, device);
}

void WebGPUTexture::PreLoad()
{
	upload();
}

HRESULT WebGPUTexture::GetLevelDesc(UINT levelIndex, D3DSURFACE_DESC *desc)
{
	if (!desc || levelIndex >= m_levels.size()) {
		return D3DERR_INVALIDCALL;
	}
	const TextureLevel &storage = m_levels[levelIndex];
	*desc = {};
	desc->Format = m_format;
	desc->Type = D3DRTYPE_SURFACE;
	desc->Usage = m_usage;
	desc->Pool = m_pool;
	desc->Size = static_cast<UINT>(storage.data.size());
	desc->Width = storage.width;
	desc->Height = storage.height;
	return D3D_OK;
}

HRESULT WebGPUTexture::GetSurfaceLevel(UINT levelIndex, IDirect3DSurface8 **surface)
{
	if (!surface || levelIndex >= m_levels.size()) {
		return D3DERR_INVALIDCALL;
	}
	*surface = new WebGPUSurface(this, levelIndex);
	return D3D_OK;
}

HRESULT WebGPUTexture::LockRect(UINT levelIndex, D3DLOCKED_RECT *lockedRect, const RECT *rect, DWORD)
{
	if (!lockedRect || levelIndex >= m_levels.size()) {
		return D3DERR_INVALIDCALL;
	}
	TextureLevel &storage = m_levels[levelIndex];
	if (rect && (rect->left < 0 || rect->top < 0 || rect->right > static_cast<LONG>(storage.width) || rect->bottom > static_cast<LONG>(storage.height))) {
		return D3DERR_INVALIDCALL;
	}
	const UINT x = rect ? static_cast<UINT>(rect->left) : 0;
	const UINT y = rect ? static_cast<UINT>(rect->top) : 0;
	const UINT bytesPerPixel = storage.width ? storage.pitch / storage.width : 0;
	lockedRect->Pitch = storage.pitch;
	lockedRect->pBits = storage.data.data() + static_cast<size_t>(y) * storage.pitch + x * bytesPerPixel;
	m_dirty = true;
	return D3D_OK;
}

HRESULT WebGPUTexture::UnlockRect(UINT levelIndex)
{
	if (levelIndex >= m_levels.size()) {
		return D3DERR_INVALIDCALL;
	}
	m_dirty = true;
	return D3D_OK;
}

bool WebGPUTexture::upload()
{
	if (!m_dirty && m_view) {
		return true;
	}
	const WGPUTextureFormat compressedFormat = wgpuDeviceHasFeature(m_device->webGPUDevice(), WGPUFeatureName_TextureCompressionBC)
		? CompressedTextureFormat(m_format) : WGPUTextureFormat_Undefined;
	const bool compressed = compressedFormat != WGPUTextureFormat_Undefined;
	if (!m_texture) {
		WGPUTextureDescriptor descriptor = WGPU_TEXTURE_DESCRIPTOR_INIT;
		descriptor.usage = WGPUTextureUsage_TextureBinding | WGPUTextureUsage_CopyDst;
		if (compressedFormat == WGPUTextureFormat_Undefined) {
			descriptor.usage |= WGPUTextureUsage_RenderAttachment;
		}
		descriptor.dimension = WGPUTextureDimension_2D;
		descriptor.size = { m_levels[0].width, m_levels[0].height, 1 };
		descriptor.format = compressedFormat == WGPUTextureFormat_Undefined
			? WGPUTextureFormat_RGBA8Unorm : compressedFormat;
		descriptor.mipLevelCount = static_cast<uint32_t>(m_levels.size());
		descriptor.sampleCount = 1;
		m_texture = wgpuDeviceCreateTexture(m_device->webGPUDevice(), &descriptor);
		if (!m_texture) {
			return false;
		}
		m_view = wgpuTextureCreateView(m_texture, nullptr);
	}
	for (UINT levelIndex = 0; levelIndex < m_levels.size(); ++levelIndex) {
		const TextureLevel &storage = m_levels[levelIndex];
		std::vector<uint8_t> rgba;
		const uint8_t *source = storage.data.data();
		UINT rowBytes = storage.pitch;
		UINT rowCount = FormatRowCount(m_format, storage.height);
		if (!compressed) {
			ConvertToRGBA(source, storage.width, storage.height, m_format, rgba);
			source = rgba.data();
			rowBytes = storage.width * 4;
			rowCount = storage.height;
		}
		const UINT paddedRowBytes = (rowBytes + 255) & ~255U;
		std::vector<uint8_t> padded(static_cast<size_t>(paddedRowBytes) * rowCount);
		for (UINT y = 0; y < rowCount; ++y) {
			std::memcpy(padded.data() + static_cast<size_t>(y) * paddedRowBytes, source + static_cast<size_t>(y) * rowBytes, rowBytes);
		}

		WGPUTexelCopyTextureInfo destination = WGPU_TEXEL_COPY_TEXTURE_INFO_INIT;
		destination.texture = m_texture;
		destination.mipLevel = levelIndex;
		destination.aspect = WGPUTextureAspect_All;
		WGPUTexelCopyBufferLayout layout = WGPU_TEXEL_COPY_BUFFER_LAYOUT_INIT;
		layout.bytesPerRow = paddedRowBytes;
		layout.rowsPerImage = rowCount;
		WGPUExtent3D extent = { storage.width, storage.height, 1 };
		// GeneralsX @bugfix zhwp 17/10/2026 A block-compressed mip copy must cover whole 4x4 blocks, as D3D stores them.
		if (compressed) {
			extent.width = (storage.width + 3) & ~3U;
			extent.height = (storage.height + 3) & ~3U;
		}
		wgpuQueueWriteTexture(m_device->webGPUQueue(), &destination, padded.data(), padded.size(), &layout, &extent);
	}
	m_dirty = false;
	return true;
}

WGPUTextureView WebGPUTexture::view()
{
	return upload() ? m_view : nullptr;
}

// GeneralsX @port Codex 04/08/2026 Expose one texture mip as a WebGPU render attachment.
WGPUTextureView WebGPUTexture::createRenderView(UINT levelIndex)
{
	if (levelIndex >= m_levels.size() || !upload()) {
		return nullptr;
	}
	WGPUTextureViewDescriptor descriptor = WGPU_TEXTURE_VIEW_DESCRIPTOR_INIT;
	descriptor.format = WGPUTextureFormat_RGBA8Unorm;
	descriptor.dimension = WGPUTextureViewDimension_2D;
	descriptor.baseMipLevel = levelIndex;
	descriptor.mipLevelCount = 1;
	descriptor.baseArrayLayer = 0;
	descriptor.arrayLayerCount = 1;
	descriptor.aspect = WGPUTextureAspect_All;
	return wgpuTextureCreateView(m_texture, &descriptor);
}

void WebGPUTexture::copyFrom(const WebGPUTexture &source)
{
	const size_t count = std::min(m_levels.size(), source.m_levels.size());
	for (size_t index = 0; index < count; ++index) {
		m_levels[index].data = source.m_levels[index].data;
	}
	m_dirty = true;
}

WebGPUSurface::WebGPUSurface(WebGPUD3DDevice *device, UINT width, UINT height, D3DFORMAT format, DWORD usage, D3DPOOL pool, bool retainDevice) :
	m_device(device),
	m_format(format),
	m_usage(usage),
	m_pool(pool),
	m_retainsDevice(retainDevice)
{
	if (m_retainsDevice) {
		m_device->AddRef();
	}
	m_storage.width = width;
	m_storage.height = height;
	m_storage.pitch = FormatRowPitch(format, width);
	m_storage.data.resize(static_cast<size_t>(m_storage.pitch) * FormatRowCount(format, height));
}

WebGPUSurface::WebGPUSurface(WebGPUTexture *texture, UINT levelIndex) :
	m_texture(texture),
	m_level(levelIndex),
	m_format(texture->format()),
	// GeneralsX @bugfix zhwp 17/10/2026 Keep the texture's depth-stencil usage on its surfaces.
	m_usage(texture->usage()),
	m_pool(D3DPOOL_DEFAULT)
{
	m_texture->AddRef();
	IDirect3DDevice8 *device = nullptr;
	m_texture->GetDevice(&device);
	m_device = static_cast<WebGPUD3DDevice *>(device);
}

WebGPUSurface::~WebGPUSurface()
{
	if (m_gpuView) {
		wgpuTextureViewRelease(m_gpuView);
	}
	if (m_gpuTexture) {
		wgpuTextureRelease(m_gpuTexture);
	}
	if (m_texture) {
		m_texture->Release();
	}
	if (m_device && m_retainsDevice) {
		m_device->Release();
	}
}

HRESULT WebGPUSurface::QueryInterface(REFIID, void **output)
{
	if (!output) {
		return E_POINTER;
	}
	*output = this;
	AddRef();
	return S_OK;
}

ULONG WebGPUSurface::AddRef()
{
	return ++m_refs;
}

ULONG WebGPUSurface::Release()
{
	const ULONG refs = --m_refs;
	if (!refs) {
		delete this;
	}
	return refs;
}

HRESULT WebGPUSurface::GetDevice(IDirect3DDevice8 **device)
{
	return ReturnObject<IDirect3DDevice8>(m_device, device);
}

HRESULT WebGPUSurface::GetContainer(REFIID, void **container)
{
	if (!container || !m_texture) {
		return E_NOINTERFACE;
	}
	*container = m_texture;
	m_texture->AddRef();
	return S_OK;
}

HRESULT WebGPUSurface::GetDesc(D3DSURFACE_DESC *desc)
{
	if (!desc) {
		return D3DERR_INVALIDCALL;
	}
	const TextureLevel &storage = level();
	*desc = {};
	desc->Format = m_format;
	desc->Type = D3DRTYPE_SURFACE;
	desc->Usage = m_usage;
	desc->Pool = m_pool;
	desc->Size = static_cast<UINT>(storage.data.size());
	desc->Width = storage.width;
	desc->Height = storage.height;
	return D3D_OK;
}

HRESULT WebGPUSurface::LockRect(D3DLOCKED_RECT *lockedRect, const RECT *rect, DWORD flags)
{
	if (m_texture) {
		return m_texture->LockRect(m_level, lockedRect, rect, flags);
	}
	if (!lockedRect) {
		return D3DERR_INVALIDCALL;
	}
	const UINT x = rect ? static_cast<UINT>(rect->left) : 0;
	const UINT y = rect ? static_cast<UINT>(rect->top) : 0;
	const UINT bytesPerPixel = m_storage.width ? m_storage.pitch / m_storage.width : 0;
	lockedRect->Pitch = m_storage.pitch;
	lockedRect->pBits = m_storage.data.data() + static_cast<size_t>(y) * m_storage.pitch + x * bytesPerPixel;
	return D3D_OK;
}

HRESULT WebGPUSurface::UnlockRect()
{
	return m_texture ? m_texture->UnlockRect(m_level) : D3D_OK;
}

TextureLevel &WebGPUSurface::level()
{
	return m_texture ? m_texture->level(m_level) : m_storage;
}

const TextureLevel &WebGPUSurface::level() const
{
	return m_texture ? m_texture->level(m_level) : m_storage;
}

void WebGPUSurface::markDirty()
{
	if (m_texture) {
		m_texture->markDirty();
	}
}

// GeneralsX @bugfix zhwp 17/10/2026 Classify a surface as depth from its D3D format or depth-stencil usage.
bool WebGPUSurface::isDepthSurface() const
{
	return IsDepthFormat(m_format) || (m_usage & D3DUSAGE_DEPTHSTENCIL) != 0;
}

// GeneralsX @port Codex 04/08/2026 Back Direct3D render and depth surfaces with WebGPU attachments.
WGPUTextureView WebGPUSurface::renderView()
{
	if (m_gpuView) {
		return m_gpuView;
	}
	// GeneralsX @bugfix zhwp 17/10/2026 Never expose a colour texture view as the depth-stencil attachment.
	const bool depth = isDepthSurface();
	if (m_texture && !depth) {
		m_gpuView = m_texture->createRenderView(m_level);
		return m_gpuView;
	}
	if (!depth && !(m_usage & D3DUSAGE_RENDERTARGET)) {
		return nullptr;
	}

	const TextureLevel &storage = level();
	WGPUTextureDescriptor descriptor = WGPU_TEXTURE_DESCRIPTOR_INIT;
	descriptor.usage = WGPUTextureUsage_RenderAttachment;
	descriptor.dimension = WGPUTextureDimension_2D;
	descriptor.size = { storage.width, storage.height, 1 };
	descriptor.format = depth ? WGPUTextureFormat_Depth24PlusStencil8 : WGPUTextureFormat_RGBA8Unorm;
	descriptor.mipLevelCount = 1;
	descriptor.sampleCount = 1;
	m_gpuTexture = wgpuDeviceCreateTexture(m_device->webGPUDevice(), &descriptor);
	m_gpuView = m_gpuTexture ? wgpuTextureCreateView(m_gpuTexture, nullptr) : nullptr;
	return m_gpuView;
}

bool WebGPUDirect3D8::initialize()
{
	if (!m_context.initialize("#canvas", kDefaultWidth, kDefaultHeight, nullptr, nullptr)) {
		return false;
	}
	while (!m_context.isReady() && !m_context.hasFailed()) {
		emscripten_sleep(1);
	}
	return m_context.isReady();
}

HRESULT WebGPUDirect3D8::QueryInterface(REFIID, void **output)
{
	if (!output) {
		return E_POINTER;
	}
	*output = this;
	AddRef();
	return S_OK;
}

ULONG WebGPUDirect3D8::Release()
{
	const ULONG refs = --m_refs;
	if (!refs) {
		delete this;
	}
	return refs;
}

HRESULT WebGPUDirect3D8::GetAdapterIdentifier(UINT adapter, DWORD, D3DADAPTER_IDENTIFIER8 *identifier)
{
	if (adapter || !identifier) {
		return D3DERR_INVALIDCALL;
	}
	*identifier = {};
	std::strncpy(identifier->Driver, "WebGPU", sizeof(identifier->Driver) - 1);
	std::strncpy(identifier->Description, "Chrome WebGPU", sizeof(identifier->Description) - 1);
	identifier->VendorId = 0;
	identifier->DeviceId = 0;
	identifier->WHQLLevel = 1;
	return D3D_OK;
}

HRESULT WebGPUDirect3D8::EnumAdapterModes(UINT adapter, UINT modeIndex, D3DDISPLAYMODE *displayMode)
{
	static constexpr std::array<std::pair<UINT, UINT>, 6> modes = {
		std::pair { 800U, 600U },
		std::pair { 1024U, 768U },
		std::pair { 1280U, 720U },
		std::pair { 1280U, 800U },
		std::pair { 1600U, 900U },
		std::pair { 1920U, 1080U },
	};
	if (adapter || modeIndex >= modes.size() || !displayMode) {
		return D3DERR_INVALIDCALL;
	}
	displayMode->Width = modes[modeIndex].first;
	displayMode->Height = modes[modeIndex].second;
	displayMode->RefreshRate = 60;
	displayMode->Format = D3DFMT_X8R8G8B8;
	return D3D_OK;
}

HRESULT WebGPUDirect3D8::GetAdapterDisplayMode(UINT adapter, D3DDISPLAYMODE *displayMode)
{
	if (adapter || !displayMode) {
		return D3DERR_INVALIDCALL;
	}
	displayMode->Width = kDefaultWidth;
	displayMode->Height = kDefaultHeight;
	displayMode->RefreshRate = 60;
	displayMode->Format = D3DFMT_X8R8G8B8;
	return D3D_OK;
}

HRESULT WebGPUDirect3D8::CheckDeviceFormat(UINT adapter, D3DDEVTYPE, D3DFORMAT, DWORD usage, D3DRESOURCETYPE type, D3DFORMAT format)
{
	if (adapter || (type != D3DRTYPE_TEXTURE && type != D3DRTYPE_SURFACE)) {
		return D3DERR_NOTAVAILABLE;
	}
	if (usage & D3DUSAGE_DEPTHSTENCIL) {
		return (format == D3DFMT_D16 || format == D3DFMT_D24S8 || format == D3DFMT_D24X8 || format == D3DFMT_D32) ? D3D_OK : D3DERR_NOTAVAILABLE;
	}
	switch (format) {
		case D3DFMT_A8R8G8B8:
		case D3DFMT_X8R8G8B8:
		case D3DFMT_R5G6B5:
		case D3DFMT_A4R4G4B4:
		case D3DFMT_A1R5G5B5:
		case D3DFMT_L8:
		case D3DFMT_A8:
		case D3DFMT_A8L8:
		case D3DFMT_DXT1:
		case D3DFMT_DXT2:
		case D3DFMT_DXT3:
		case D3DFMT_DXT4:
		case D3DFMT_DXT5:
			return D3D_OK;
		default:
			return D3DERR_NOTAVAILABLE;
	}
}

HRESULT WebGPUDirect3D8::CheckDepthStencilMatch(UINT adapter, D3DDEVTYPE, D3DFORMAT, D3DFORMAT, D3DFORMAT depthFormat)
{
	if (adapter) {
		return D3DERR_INVALIDCALL;
	}
	return (depthFormat == D3DFMT_D16 || depthFormat == D3DFMT_D24S8 || depthFormat == D3DFMT_D24X8 || depthFormat == D3DFMT_D32) ? D3D_OK : D3DERR_NOTAVAILABLE;
}

HRESULT WebGPUDirect3D8::GetDeviceCaps(UINT adapter, D3DDEVTYPE type, D3DCAPS8 *caps)
{
	if (adapter || !caps) {
		return D3DERR_INVALIDCALL;
	}
	*caps = {};
	caps->DeviceType = type;
	caps->AdapterOrdinal = adapter;
	caps->Caps = D3DCAPS_READ_SCANLINE;
	caps->DevCaps = D3DDEVCAPS_HWRASTERIZATION | D3DDEVCAPS_DRAWPRIMTLVERTEX | D3DDEVCAPS_DRAWPRIMITIVES2 | D3DDEVCAPS_DRAWPRIMITIVES2EX;
	caps->PrimitiveMiscCaps = D3DPMISCCAPS_CULLNONE | D3DPMISCCAPS_CULLCW | D3DPMISCCAPS_CULLCCW | D3DPMISCCAPS_COLORWRITEENABLE;
	caps->RasterCaps = D3DPRASTERCAPS_DITHER | D3DPRASTERCAPS_FOGVERTEX;
	caps->ZCmpCaps = D3DPCMPCAPS_ALWAYS | D3DPCMPCAPS_LESSEQUAL | D3DPCMPCAPS_LESS | D3DPCMPCAPS_EQUAL | D3DPCMPCAPS_GREATER | D3DPCMPCAPS_GREATEREQUAL;
	caps->SrcBlendCaps = D3DPBLENDCAPS_ZERO | D3DPBLENDCAPS_ONE | D3DPBLENDCAPS_SRCCOLOR | D3DPBLENDCAPS_INVSRCCOLOR |
		D3DPBLENDCAPS_SRCALPHA | D3DPBLENDCAPS_INVSRCALPHA | D3DPBLENDCAPS_DESTALPHA |
		D3DPBLENDCAPS_INVDESTALPHA | D3DPBLENDCAPS_DESTCOLOR | D3DPBLENDCAPS_INVDESTCOLOR;
	caps->DestBlendCaps = caps->SrcBlendCaps;
	caps->AlphaCmpCaps = caps->ZCmpCaps;
	caps->StencilCaps = D3DSTENCILCAPS_KEEP | D3DSTENCILCAPS_ZERO | D3DSTENCILCAPS_REPLACE |
		D3DSTENCILCAPS_INCRSAT | D3DSTENCILCAPS_DECRSAT | D3DSTENCILCAPS_INVERT |
		D3DSTENCILCAPS_INCR | D3DSTENCILCAPS_DECR;
	caps->ShadeCaps = D3DPSHADECAPS_COLORGOURAUDRGB | D3DPSHADECAPS_ALPHAGOURAUDBLEND;
	caps->TextureCaps = D3DPTEXTURECAPS_ALPHA | D3DPTEXTURECAPS_MIPMAP | D3DPTEXTURECAPS_PERSPECTIVE;
	// GeneralsX @bugfix zhwp 19/10/2026 The samplers support anisotropic filtering (up to MaxAnisotropy); without these caps the engine clamped it to 1 and saved 2x on every Options accept.
	caps->TextureFilterCaps = D3DPTFILTERCAPS_MINFPOINT | D3DPTFILTERCAPS_MINFLINEAR | D3DPTFILTERCAPS_MAGFPOINT | D3DPTFILTERCAPS_MAGFLINEAR | D3DPTFILTERCAPS_MIPFPOINT | D3DPTFILTERCAPS_MIPFLINEAR |
		D3DPTFILTERCAPS_MINFANISOTROPIC | D3DPTFILTERCAPS_MAGFANISOTROPIC;
	caps->TextureAddressCaps = D3DPTADDRESSCAPS_WRAP | D3DPTADDRESSCAPS_CLAMP | D3DPTADDRESSCAPS_MIRROR;
	caps->TextureOpCaps = D3DTEXOPCAPS_DISABLE | D3DTEXOPCAPS_SELECTARG1 | D3DTEXOPCAPS_SELECTARG2 |
		D3DTEXOPCAPS_MODULATE | D3DTEXOPCAPS_MODULATE2X | D3DTEXOPCAPS_MODULATE4X | D3DTEXOPCAPS_ADD |
		D3DTEXOPCAPS_ADDSIGNED | D3DTEXOPCAPS_ADDSIGNED2X | D3DTEXOPCAPS_SUBTRACT | D3DTEXOPCAPS_ADDSMOOTH |
		D3DTEXOPCAPS_BLENDDIFFUSEALPHA | D3DTEXOPCAPS_BLENDTEXTUREALPHA | D3DTEXOPCAPS_BLENDFACTORALPHA |
		D3DTEXOPCAPS_BLENDTEXTUREALPHAPM | D3DTEXOPCAPS_BLENDCURRENTALPHA |
		D3DTEXOPCAPS_MODULATEALPHA_ADDCOLOR | D3DTEXOPCAPS_MODULATECOLOR_ADDALPHA |
		D3DTEXOPCAPS_MODULATEINVALPHA_ADDCOLOR | D3DTEXOPCAPS_MODULATEINVCOLOR_ADDALPHA |
		D3DTEXOPCAPS_MULTIPLYADD | D3DTEXOPCAPS_LERP;
	caps->MaxTextureWidth = 8192;
	caps->MaxTextureHeight = 8192;
	caps->MaxTextureRepeat = 8192;
	caps->MaxTextureAspectRatio = 8192;
	caps->MaxAnisotropy = 16;
	caps->MaxVertexW = 1.0e10f;
	caps->GuardBandLeft = -1.0e10f;
	caps->GuardBandTop = -1.0e10f;
	caps->GuardBandRight = 1.0e10f;
	caps->GuardBandBottom = 1.0e10f;
	caps->MaxActiveLights = 8;
	caps->MaxUserClipPlanes = 0;
	caps->MaxVertexBlendMatrices = 1;
	caps->MaxPrimitiveCount = 0x00ffffff;
	caps->MaxVertexIndex = 0x00ffffff;
	caps->MaxStreams = 1;
	caps->MaxStreamStride = 255;
	caps->MaxSimultaneousTextures = 4;
	caps->MaxTextureBlendStages = 4;
	caps->PixelShaderVersion = D3DPS_VERSION(1, 1);
	caps->MaxPixelShaderValue = 1.0f;
	caps->MaxPointSize = 1.0f;
	return D3D_OK;
}

HRESULT WebGPUDirect3D8::CreateDevice(UINT adapter, D3DDEVTYPE type, HWND window, DWORD behavior, D3DPRESENT_PARAMETERS *parameters, IDirect3DDevice8 **device)
{
	if (adapter || !parameters || !device) {
		return D3DERR_INVALIDCALL;
	}
	auto *created = new WebGPUD3DDevice(this, &m_context, *parameters);
	created->m_creation.AdapterOrdinal = adapter;
	created->m_creation.DeviceType = type;
	created->m_creation.hFocusWindow = window;
	created->m_creation.BehaviorFlags = behavior;
	if (!created->initialize()) {
		created->Release();
		return D3DERR_NOTAVAILABLE;
	}
	*device = created;
	return D3D_OK;
}

} // namespace
