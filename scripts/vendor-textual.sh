#!/usr/bin/env bash
# Clone and patch the vendored textual dependency for Swift 6.2 + macOS 14 compatibility.
# Run from repo root: bash scripts/vendor-textual.sh
#
# Patches applied:
#   1. Platform: lower macOS minimum from v15 to v14
#   2. Sendability: bounce onPreferenceChange state writes onto MainActor (3 files)
#   3. Group(subviews:) macOS 15 API: guard with #available, VStack fallback
#   4. AttributedString keyPath: replace generic helpers that crash Swift 6.2 compiler
#   5. CGSize Hashable: add HashableCGSize wrapper (CGSize Hashable only in macOS 15)
#   6. TextBuilder: use HashableCGSize in NSCache keys
#   7. FontModifier: remove @available guard on ScaleFontModifier, stub Font.scaled(by:)
#   8. FontScaleModifier: always use reflected provider fallback
#   9. FontScaleProperty: always use reflected provider fallback
#  10. Overflow: replace onScrollGeometryChange with macOS 14-safe geometry observation

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR_DIR="${ROOT_DIR}/apps/macos/Vendor/textual"

if [[ -d "${VENDOR_DIR}/Sources" ]]; then
  echo "==> Vendor/textual already exists, skipping clone"
else
  echo "==> Cloning gonzalezreal/textual..."
  mkdir -p "$(dirname "${VENDOR_DIR}")"
  git clone --depth 1 https://github.com/gonzalezreal/textual.git "${VENDOR_DIR}"
fi

echo "==> Applying patches..."

# --- Patch 1: Lower macOS platform to v14 ---

FILE="${VENDOR_DIR}/Package.swift"
if grep -q '\.macOS(.v15)' "$FILE" 2>/dev/null; then
  sed -i '' 's/\.macOS(.v15)/\.macOS(.v14)/' "$FILE"
  echo "  Patched Package.swift (macOS v14)"
else
  echo "  Package.swift already at macOS v14"
fi

# --- Patch 2: Sendability fixes for onPreferenceChange closures (3 files) ---
# Swift 6.2 treats onPreferenceChange closures as @Sendable, so direct @State mutation and
# reading @Environment values inside those closures produces warnings. Snapshot environment-
# derived values outside the closure and bounce mutations onto MainActor.

FILE="${VENDOR_DIR}/Sources/Textual/Internal/StructuredText/BlockVStack.swift"
if grep -q 'let preferredSpacing = listItemSpacingEnabled ? resolvedListItemSpacing : nil' "$FILE" 2>/dev/null; then
  echo "  BlockVStack.swift sendability already patched"
else
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

old = '''    var body: some View {
      // Read the block spacing preference and apply it as a layout value
      content
        .onPreferenceChange(BlockSpacingKey.self) { value in
          // Override with the resolved list item spacing if enabled
          blockSpacing = listItemSpacingEnabled ? resolvedListItemSpacing : value
        }
        .layoutValue(key: BlockSpacingKey.self, value: blockSpacing)
    }'''

new = '''    var body: some View {
      let preferredSpacing = listItemSpacingEnabled ? resolvedListItemSpacing : nil

      // Read the block spacing preference and apply it as a layout value
      content
        .onPreferenceChange(BlockSpacingKey.self) { value in
          let nextSpacing = preferredSpacing ?? value
          Task { @MainActor in
            blockSpacing = nextSpacing
          }
        }
        .layoutValue(key: BlockSpacingKey.self, value: blockSpacing)
    }'''

if old not in s:
    raise SystemExit('expected BlockVStack snippet not found')

s = s.replace(old, new, 1)
with open(p, 'w') as f: f.write(s)
print('  Patched BlockVStack.swift sendability')
" "$FILE"
fi

FILE="${VENDOR_DIR}/Sources/Textual/Internal/StructuredText/Table.swift"
if grep -q 'let nextSpacing = $0' "$FILE" 2>/dev/null; then
  echo "  Table.swift sendability already patched"
else
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

old = '''      let resolvedStyle = tableStyle.resolve(configuration: configuration)
        .onPreferenceChange(TableCell.SpacingKey.self) {
          spacing = $0
        }'''

new = '''      let resolvedStyle = tableStyle.resolve(configuration: configuration)
        .onPreferenceChange(TableCell.SpacingKey.self) {
          let nextSpacing = $0
          Task { @MainActor in
            spacing = nextSpacing
          }
        }'''

if old not in s:
    raise SystemExit('expected Table snippet not found')

s = s.replace(old, new, 1)
with open(p, 'w') as f: f.write(s)
print('  Patched Table.swift sendability')
" "$FILE"
fi

FILE="${VENDOR_DIR}/Sources/Textual/Internal/StructuredText/OrderedList.swift"
if grep -q 'let nextMarkerWidth = $0' "$FILE" 2>/dev/null; then
  echo "  OrderedList.swift sendability already patched"
else
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

old = '''      .onPreferenceChange(MarkerWidthKey.self) {
        markerWidth = $0
      }'''

new = '''      .onPreferenceChange(MarkerWidthKey.self) {
        let nextMarkerWidth = $0
        Task { @MainActor in
          markerWidth = nextMarkerWidth
        }
      }'''

if old not in s:
    raise SystemExit('expected OrderedList snippet not found')

s = s.replace(old, new, 1)
with open(p, 'w') as f: f.write(s)
print('  Patched OrderedList.swift sendability')
" "$FILE"
fi

# --- Patch 3: Group(subviews:) requires macOS 15 ---
# Wrap in #available guard with VStack fallback for macOS 14.

FILE="${VENDOR_DIR}/Sources/Textual/Internal/StructuredText/BlockVStack.swift"
if grep -q 'Group(subviews: content)' "$FILE" 2>/dev/null && ! grep -q '#available(macOS 15' "$FILE" 2>/dev/null; then
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

# Add horizontalAlignment computed property before body
s = s.replace(
    '''    var body: some View {
      Group(subviews: content) { children in
        BlockVStackLayout(textAlignment: textAlignment) {
          ForEach(children) {
            BlockLayoutView(\$0)
          }
        }
      }
    }''',
    '''    private var horizontalAlignment: HorizontalAlignment {
      switch textAlignment {
      case .leading:
        return .leading
      case .center:
        return .center
      case .trailing:
        return .trailing
      }
    }

    var body: some View {
      if #available(macOS 15.0, *) {
        Group(subviews: content) { children in
          BlockVStackLayout(textAlignment: textAlignment) {
            ForEach(children) {
              BlockLayoutView(\$0)
            }
          }
        }
      } else {
        VStack(alignment: horizontalAlignment, spacing: 0) {
          content
        }
      }
    }'''
)
with open(p, 'w') as f: f.write(s)
print('  Patched BlockVStack.swift (Group subviews #available guard)')
" "$FILE"
else
  echo "  BlockVStack.swift Group(subviews:) already patched"
fi

# --- Patch 4: AttributedString keyPath compiler crash ---
# Swift 6.2 crashes (assertion in CSSimplify.cpp) on generic keyPath subscript
# access like run.attributes[keyPath: keyPath]. Replace with concrete overloads.

FILE="${VENDOR_DIR}/Sources/Textual/Internal/Helpers/AttributedString.swift"
if grep -q 'containsValues<T>' "$FILE" 2>/dev/null; then
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

s = s.replace(
    '''  func containsValues<T>(for keyPaths: Set<KeyPath<AttributeContainer, T?>>) -> Bool {
    runs.contains { run in
      keyPaths.first { keyPath in
        run.attributes[keyPath: keyPath] != nil
      } != nil
    }
  }

  func uniqueValues<T: Hashable>(for keyPath: KeyPath<AttributeContainer, T?>) -> Set<T> {
    var values: Set<T> = []
    for run in runs {
      if let value = run.attributes[keyPath: keyPath] {
        values.insert(value)
      }
    }
    return values
  }''',
    '''  // Swift 6.2 compiler crash workaround: avoid generic keyPath subscript on
  // AttributeContainer (assertion failure in CSSimplify.cpp). Provide concrete
  // overloads for the two call-sites used by Textual instead.

  func containsImageOrEmojiURL() -> Bool {
    runs.contains { run in
      run.imageURL != nil || run.textual.emojiURL != nil
    }
  }

  func uniqueAttachments() -> Set<AnyAttachment> {
    var values: Set<AnyAttachment> = []
    for run in runs {
      if let value = run.textual.attachment {
        values.insert(value)
      }
    }
    return values
  }'''
)

# Update call-sites
s = s.replace('uniqueValues(for: \\\\.textual.attachment)', 'uniqueAttachments()')

with open(p, 'w') as f: f.write(s)
print('  Patched AttributedString.swift')
" "$FILE"
else
  echo "  AttributedString.swift already patched"
fi

# Update WithAttachments.swift call-site
FILE="${VENDOR_DIR}/Sources/Textual/Internal/Attachment/WithAttachments.swift"
if grep -q 'containsValues(for:' "$FILE" 2>/dev/null; then
  sed -i '' 's/attributedString\.containsValues(for: \[\\\.imageURL, \\\.textual\.emojiURL\])/attributedString.containsImageOrEmojiURL()/' "$FILE"
  echo "  Patched WithAttachments.swift"
else
  echo "  WithAttachments.swift already patched"
fi

# --- Patch 5: CGSize Hashable wrapper for macOS 14 ---
# CGSize only conforms to Hashable on macOS 15+. TextBuilder needs it for NSCache keys.

FILE="${VENDOR_DIR}/Sources/Textual/Internal/Helpers/Box.swift"
if ! grep -q 'HashableCGSize' "$FILE" 2>/dev/null; then
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

# Prepend CoreGraphics import and HashableCGSize before the existing content
wrapper = '''import CoreGraphics
import Foundation

/// Hashable wrapper for CGSize that works on macOS 14+.
/// (CGSize gained native Hashable only in macOS 15.)
struct HashableCGSize: Hashable, Sendable {
  let width: CGFloat
  let height: CGFloat

  init(_ size: CGSize) {
    self.width = size.width
    self.height = size.height
  }

  var cgSize: CGSize { CGSize(width: width, height: height) }
}

'''

# Replace the original Foundation import with our new header
s = s.replace('import Foundation\n', wrapper, 1)

with open(p, 'w') as f: f.write(s)
print('  Patched Box.swift (added HashableCGSize)')
" "$FILE"
else
  echo "  Box.swift HashableCGSize already present"
fi

# --- Patch 6: TextBuilder — use HashableCGSize in NSCache keys ---

FILE="${VENDOR_DIR}/Sources/Textual/Internal/TextFragment/TextBuilder.swift"
if grep -q 'NSCache<KeyBox<\[AttachmentKey: CGSize\]>' "$FILE" 2>/dev/null; then
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

# Change cache type
s = s.replace(
    'NSCache<KeyBox<[AttachmentKey: CGSize]>, Box<Text>>()',
    'NSCache<KeyBox<[AttachmentKey: HashableCGSize]>, Box<Text>>()'
)
s = s.replace(
    'let cache: NSCache<KeyBox<[AttachmentKey: CGSize]>, Box<Text>>',
    'let cache: NSCache<KeyBox<[AttachmentKey: HashableCGSize]>, Box<Text>>'
)

# Patch init: wrap attachment sizes for cache key
s = s.replace(
    'self.cache.setObject(Box(self.text), forKey: KeyBox(attachmentSizes))',
    '''let hashableKey = attachmentSizes.mapValues { HashableCGSize(\$0) }
      self.cache.setObject(Box(self.text), forKey: KeyBox(hashableKey))'''
)

# Patch sizeChanged: wrap attachment sizes for cache key
s = s.replace(
    'let cacheKey = KeyBox(attachmentSizes)',
    '''let hashableKey = attachmentSizes.mapValues { HashableCGSize(\$0) }
      let cacheKey = KeyBox(hashableKey)'''
)

with open(p, 'w') as f: f.write(s)
print('  Patched TextBuilder.swift (HashableCGSize cache keys)')
" "$FILE"
else
  echo "  TextBuilder.swift already uses HashableCGSize"
fi

# --- Patch 7: FontModifier — ScaleFontModifier macOS 14 compat ---
# Upstream guards ScaleFontModifier behind @available(macOS 26.0, ...) and calls
# font.scaled(by:) which doesn't exist in our SDK. Remove the @available guard and
# stub the body so it only participates via modify(_ size:).

FILE="${VENDOR_DIR}/Sources/Textual/Internal/Font/FontModifier.swift"
if grep -q '@available(iOS 26.0' "$FILE" 2>/dev/null; then
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

# Remove the @available annotation line
s = s.replace('  @available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, visionOS 26.0, *)\n', '')

# Replace font.scaled(by:) call with a comment-only body
s = s.replace(
    '      font = font.scaled(by: scaleFactor)',
    '''      // Older SDKs do not expose Font.scaled(by:), so reflected scale modifiers only
      // participate in measurement through modify(_ size:).'''
)

with open(p, 'w') as f: f.write(s)
print('  Patched FontModifier.swift (ScaleFontModifier)')
" "$FILE"
else
  echo "  FontModifier.swift already patched"
fi

# --- Patch 8: FontScaleModifier — remove Font.scaled(by:) path ---
# The SDK we are targeting does not expose Font.scaled(by:), so always use the
# reflected provider fallback.

FILE="${VENDOR_DIR}/Sources/Textual/Internal/Font/FontScaleModifier.swift"
if grep -q 'font.scaled(by: scale)' "$FILE" 2>/dev/null; then
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

s = s.replace(
    '// Applies arbitrary font scaling. Uses Font.scaled(by:) on iOS 26+ where available.\n// On earlier platforms, falls back to font reflection and manual scaling via FontProvider.\n',
    '// Applies arbitrary font scaling using font reflection and manual scaling via FontProvider.\n'
)

s = s.replace(
    '''  func body(content: Content) -> some View {
    #if compiler(>=6.2)
      if #available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, visionOS 26.0, *) {
        content.font(font.scaled(by: scale))
      } else {
        content.font(modifiedFont())
      }
    #else
      content.font(modifiedFont())
    #endif
  }''',
    '''  func body(content: Content) -> some View {
    content.font(modifiedFont())
  }'''
)

with open(p, 'w') as f: f.write(s)
print('  Patched FontScaleModifier.swift')
" "$FILE"
else
  echo "  FontScaleModifier.swift already patched"
fi

# --- Patch 9: FontScaleProperty — remove Font.scaled(by:) path ---
# Same issue as FontScaleModifier.swift; use the reflected provider path only.

FILE="${VENDOR_DIR}/Sources/Textual/TextProperty/Font/FontScaleProperty.swift"
if grep -q 'font.scaled(by: scale)' "$FILE" 2>/dev/null; then
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

s = s.replace(
    '''  public func apply(in attributes: inout AttributeContainer, environment: TextEnvironmentValues) {
    let font = attributes.font ?? environment.font ?? .body
    #if compiler(>=6.2)
      if #available(iOS 26.0, macOS 26.0, tvOS 26.0, watchOS 26.0, visionOS 26.0, *) {
        attributes.font = font.scaled(by: scale)
      } else if var provider = font.provider() {
        provider.scale = scale
        attributes.font = provider.resolve(in: environment)
      }
    #else
      if var provider = font.provider() {
        provider.scale = scale
        attributes.font = provider.resolve(in: environment)
      }
    #endif
  }''',
    '''  public func apply(in attributes: inout AttributeContainer, environment: TextEnvironmentValues) {
    let font = attributes.font ?? environment.font ?? .body
    if var provider = font.provider() {
      provider.scale = scale
      attributes.font = provider.resolve(in: environment)
    }
  }'''
)

with open(p, 'w') as f: f.write(s)
print('  Patched FontScaleProperty.swift')
" "$FILE"
else
  echo "  FontScaleProperty.swift already patched"
fi

# --- Patch 10: Overflow — replace onScrollGeometryChange ---
# onScrollGeometryChange is not usable for our downgraded macOS path; use generic
# geometry observation instead.

FILE="${VENDOR_DIR}/Sources/Textual/StructuredText/Style/Overflow.swift"
if grep -q 'onScrollGeometryChange(for: CGFloat.self, of: \\.containerSize.width)' "$FILE" 2>/dev/null; then
  python3 -c "
import sys
p = sys.argv[1]
with open(p) as f: s = f.read()

s = s.replace(
    '''      .onScrollGeometryChange(for: CGFloat.self, of: \\.containerSize.width) {
        containerWidth = $1
      }''',
    '''      .onGeometryChange(for: CGFloat.self, of: \\.size.width) {
        containerWidth = $0
      }'''
)

with open(p, 'w') as f: f.write(s)
print('  Patched Overflow.swift')
" "$FILE"
else
  echo "  Overflow.swift already patched"
fi

echo "==> Done. Vendored textual is ready at apps/macos/Vendor/textual"
