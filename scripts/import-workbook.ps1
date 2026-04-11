param(
  [string]$WorkbookPath = $(Join-Path (Split-Path $PSScriptRoot -Parent) 'R35 Master Parts Catalog.xlsx'),
  [string]$ProjectRoot = '.'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ZipEntryText {
  param(
    [Parameter(Mandatory = $true)] $Zip,
    [Parameter(Mandatory = $true)][string]$EntryName
  )

  $entry = $Zip.GetEntry($EntryName)
  if (-not $entry) {
    return $null
  }

  $reader = [System.IO.StreamReader]::new($entry.Open())
  try {
    return $reader.ReadToEnd()
  }
  finally {
    $reader.Dispose()
  }
}

function Get-ColumnLetters {
  param([string]$CellRef)
  return ([regex]::Match($CellRef, '^[A-Z]+')).Value
}

function Normalize-PartNumber {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  return ($Value.Trim().ToUpperInvariant() -replace '\s+', '')
}

function Normalize-TextKey {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  return (($Value.Trim().ToLowerInvariant() -replace '[^a-z0-9]+', ' ') -replace '\s+', ' ').Trim()
}

function Get-RowValue {
  param(
    $Row,
    [string]$Column
  )

  if ($null -eq $Row) {
    return ''
  }

  if ($Row.Contains($Column) -and $null -ne $Row[$Column]) {
    return [string]$Row[$Column]
  }

  return ''
}

function Convert-CellValue {
  param(
    [Parameter(Mandatory = $true)] $Cell,
    [Parameter(Mandatory = $true)][string[]]$SharedStrings,
    [Parameter(Mandatory = $true)] $NamespaceManager
  )

  $cellType = $Cell.GetAttribute('t')

  if ($cellType -eq 'inlineStr') {
    $textNodes = $Cell.SelectNodes('main:is//main:t', $NamespaceManager)
    return (($textNodes | ForEach-Object { $_.InnerText }) -join '')
  }

  $valueNode = $Cell.SelectSingleNode('main:v', $NamespaceManager)
  if (-not $valueNode) {
    return ''
  }

  if ($cellType -eq 's') {
    $index = [int]$valueNode.InnerText
    if ($index -ge 0 -and $index -lt $SharedStrings.Count) {
      return $SharedStrings[$index]
    }
    return ''
  }

  return $valueNode.InnerText
}

function Get-SheetData {
  param(
    [Parameter(Mandatory = $true)] $Zip,
    [Parameter(Mandatory = $true)][string]$SheetEntry,
    [Parameter(Mandatory = $true)][string[]]$SharedStrings
  )

  [xml]$sheetXml = Get-ZipEntryText -Zip $Zip -EntryName $SheetEntry
  $sheetNs = [System.Xml.XmlNamespaceManager]::new($sheetXml.NameTable)
  $sheetNs.AddNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')

  $rows = @{}
  foreach ($rowNode in $sheetXml.SelectNodes('//main:sheetData/main:row', $sheetNs)) {
    $rowMap = [ordered]@{}
    foreach ($cell in $rowNode.SelectNodes('main:c', $sheetNs)) {
      $rowMap[(Get-ColumnLetters -CellRef $cell.r)] = (Convert-CellValue -Cell $cell -SharedStrings $SharedStrings -NamespaceManager $sheetNs)
    }
    $rows["$($rowNode.r)"] = $rowMap
  }

  $hyperlinks = [ordered]@{}
  $relsEntry = ('xl/worksheets/_rels/' + [System.IO.Path]::GetFileName($SheetEntry) + '.rels')
  $relsText = Get-ZipEntryText -Zip $Zip -EntryName $relsEntry
  if ($relsText) {
    [xml]$relsXml = $relsText
    $relNs = [System.Xml.XmlNamespaceManager]::new($relsXml.NameTable)
    $relNs.AddNamespace('rel', 'http://schemas.openxmlformats.org/package/2006/relationships')
    $relMap = @{}
    foreach ($rel in $relsXml.SelectNodes('//rel:Relationship', $relNs)) {
      $relMap[$rel.Id] = $rel.Target
    }

    foreach ($linkNode in $sheetXml.SelectNodes('//main:hyperlinks/main:hyperlink', $sheetNs)) {
      $rid = $linkNode.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
      if ($rid -and $relMap.ContainsKey($rid)) {
        $hyperlinks[$linkNode.ref] = $relMap[$rid]
      }
    }
  }

  return @{
    Rows = $rows
    Hyperlinks = $hyperlinks
    Xml = $sheetXml
    Ns = $sheetNs
  }
}

function Export-ZipEntry {
  param(
    [Parameter(Mandatory = $true)] $Zip,
    [Parameter(Mandatory = $true)][string]$EntryName,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  $entry = $Zip.GetEntry($EntryName)
  if (-not $entry) {
    return $null
  }

  $directory = Split-Path -Path $Destination -Parent
  if (-not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }

  $inputStream = $entry.Open()
  $outputStream = [System.IO.File]::Create($Destination)
  try {
    $inputStream.CopyTo($outputStream)
  }
  finally {
    $inputStream.Dispose()
    $outputStream.Dispose()
  }

  return $Destination
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRootResolved = (Resolve-Path -LiteralPath $ProjectRoot).Path
$dataDir = Join-Path $projectRootResolved 'data'
$diagramsDir = Join-Path $projectRootResolved 'assets\diagrams'

New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
New-Item -ItemType Directory -Path $diagramsDir -Force | Out-Null

$fileStream = [System.IO.File]::Open($WorkbookPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
$memoryStream = [System.IO.MemoryStream]::new()

try {
  $fileStream.CopyTo($memoryStream)
  $memoryStream.Position = 0
  $zip = [System.IO.Compression.ZipArchive]::new($memoryStream, [System.IO.Compression.ZipArchiveMode]::Read, $true)

  [xml]$sharedXml = Get-ZipEntryText -Zip $zip -EntryName 'xl/sharedStrings.xml'
  $sharedNs = [System.Xml.XmlNamespaceManager]::new($sharedXml.NameTable)
  $sharedNs.AddNamespace('main', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $sharedStrings = @()
  foreach ($si in $sharedXml.SelectNodes('//main:si', $sharedNs)) {
    $sharedStrings += (($si.SelectNodes('.//main:t', $sharedNs) | ForEach-Object { $_.InnerText }) -join '')
  }

  $organizedPartsSheet = Get-SheetData -Zip $zip -SheetEntry 'xl/worksheets/sheet1.xml' -SharedStrings $sharedStrings
  $diagramsSheet = Get-SheetData -Zip $zip -SheetEntry 'xl/worksheets/sheet2.xml' -SharedStrings $sharedStrings
  $rawLinksSheet = Get-SheetData -Zip $zip -SheetEntry 'xl/worksheets/sheet3.xml' -SharedStrings $sharedStrings
  $sourcesSheet = Get-SheetData -Zip $zip -SheetEntry 'xl/worksheets/sheet5.xml' -SharedStrings $sharedStrings

  $sources = @()
  foreach ($rowNumber in $sourcesSheet.Rows.Keys | Sort-Object { [int]$_ }) {
    $value = Get-RowValue -Row $sourcesSheet.Rows[$rowNumber] -Column 'A'
    if ([int]$rowNumber -gt 1 -and $value) {
      $sources += $value.Trim()
    }
  }

  $linkIndex = @{}
  foreach ($rowNumber in $rawLinksSheet.Rows.Keys | Sort-Object { [int]$_ }) {
    if ([int]$rowNumber -lt 5) {
      continue
    }

    $row = $rawLinksSheet.Rows[$rowNumber]
    $partNumber = Normalize-PartNumber -Value $row['B']
    if (-not $partNumber -or $partNumber -notmatch '^[A-Z0-9-]{5,}$') {
      continue
    }

    $rowLinks = @()
    foreach ($cellRef in $rawLinksSheet.Hyperlinks.Keys) {
      if ($cellRef -match "^[A-Z]+$rowNumber$") {
        $rowLinks += [PSCustomObject]@{
          cell = $cellRef
          url = $rawLinksSheet.Hyperlinks[$cellRef]
          label = if ($row.Contains((Get-ColumnLetters -CellRef $cellRef))) { $row[(Get-ColumnLetters -CellRef $cellRef)] } else { '' }
        }
      }
    }

    if (-not $linkIndex.ContainsKey($partNumber)) {
      $linkIndex[$partNumber] = [System.Collections.ArrayList]::new()
    }

    foreach ($link in $rowLinks) {
      if (-not [string]::IsNullOrWhiteSpace($link.url)) {
        $sourceName = ''
        foreach ($source in $sources) {
          if ($link.url.StartsWith($source, [System.StringComparison]::OrdinalIgnoreCase)) {
            $sourceName = $source
            break
          }
        }

        $alreadyExists = $false
        foreach ($existingLink in $linkIndex[$partNumber]) {
          if ($existingLink.url -eq $link.url) {
            $alreadyExists = $true
            break
          }
        }

        if (-not $alreadyExists) {
          [void]$linkIndex[$partNumber].Add([ordered]@{
            url = $link.url
            label = $link.label
            sourceName = $sourceName
          })
        }
      }
    }
  }

  $parts = @()
  foreach ($rowNumber in $organizedPartsSheet.Rows.Keys | Sort-Object { [int]$_ }) {
    if ([int]$rowNumber -eq 1) {
      continue
    }

    $row = $organizedPartsSheet.Rows[$rowNumber]
    $partNumber = Normalize-PartNumber -Value $row['A']
    if (-not $partNumber -or $partNumber -notmatch '^[A-Z0-9-]{5,}$') {
      continue
    }

    $description = (Get-RowValue -Row $row -Column 'B').Trim()
    $applies = (Get-RowValue -Row $row -Column 'C').Trim()
    $period = (Get-RowValue -Row $row -Column 'D').Trim()
    $requiredQty = (Get-RowValue -Row $row -Column 'E').Trim()
    $priceAed = (Get-RowValue -Row $row -Column 'F').Trim()
    $status = (Get-RowValue -Row $row -Column 'G').Trim()
    $notes = (Get-RowValue -Row $row -Column 'H').Trim()
    $links = @()
    if ($linkIndex.ContainsKey($partNumber)) {
      $links = @($linkIndex[$partNumber])
    }

    $parts += [ordered]@{
      partNumber = $partNumber
      description = $description
      appliesDetails = $applies
      period = $period
      requiredQty = $requiredQty
      priceAed = $priceAed
      status = $status
      notes = $notes
      supplierUrl = if ($links.Count -gt 0) { $links[0].url } else { $null }
      links = $links
      relatedPartNumbers = @()
    }
  }

  $partsByDescription = @{}
  foreach ($part in $parts) {
    $key = Normalize-TextKey -Value $part.description
    if (-not $key) {
      continue
    }

    if (-not $partsByDescription.ContainsKey($key)) {
      $partsByDescription[$key] = [System.Collections.ArrayList]::new()
    }

    [void]$partsByDescription[$key].Add($part.partNumber)
  }

  foreach ($part in $parts) {
    $key = Normalize-TextKey -Value $part.description
    if (-not $key) {
      continue
    }

    $related = @($partsByDescription[$key] | Where-Object { $_ -ne $part.partNumber } | Select-Object -Unique)
    $part.relatedPartNumbers = $related
  }

  [xml]$drawingXml = Get-ZipEntryText -Zip $zip -EntryName 'xl/drawings/drawing1.xml'
  [xml]$drawingRelsXml = Get-ZipEntryText -Zip $zip -EntryName 'xl/drawings/_rels/drawing1.xml.rels'
  $xdrNs = [System.Xml.XmlNamespaceManager]::new($drawingXml.NameTable)
  $xdrNs.AddNamespace('xdr', 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing')
  $xdrNs.AddNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main')
  $drawingRelNs = [System.Xml.XmlNamespaceManager]::new($drawingRelsXml.NameTable)
  $drawingRelNs.AddNamespace('rel', 'http://schemas.openxmlformats.org/package/2006/relationships')
  $drawingRelMap = @{}
  foreach ($rel in $drawingRelsXml.SelectNodes('//rel:Relationship', $drawingRelNs)) {
    $drawingRelMap[$rel.Id] = $rel.Target
  }

  $imageAnchors = @()
  foreach ($anchor in $drawingXml.SelectNodes('//xdr:twoCellAnchor', $xdrNs)) {
    $fromNode = $anchor.SelectSingleNode('xdr:from', $xdrNs)
    $picNode = $anchor.SelectSingleNode('xdr:pic', $xdrNs)
    if (-not $fromNode -or -not $picNode) {
      continue
    }

    $blipNode = $picNode.SelectSingleNode('.//a:blip', $xdrNs)
    if (-not $blipNode) {
      continue
    }

    $rid = $blipNode.GetAttribute('embed', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    $target = $drawingRelMap[$rid]
    $imageAnchors += [ordered]@{
      row = ([int]$fromNode.SelectSingleNode('xdr:row', $xdrNs).InnerText + 1)
      mediaPath = ('xl/drawings/' + $target).Replace('xl/drawings/../', 'xl/')
    }
  }

  $imageAnchors = @($imageAnchors | Sort-Object row)
  $diagramRows = @()
  foreach ($cellRef in $diagramsSheet.Hyperlinks.Keys | Sort-Object { [int]([regex]::Match($_, '\d+$').Value) }) {
    if ($cellRef -notmatch '^A(\d+)$') {
      continue
    }

    $rowNumber = [int]$Matches[1]
    $title = (Get-RowValue -Row $diagramsSheet.Rows["$rowNumber"] -Column 'A').Trim()
    if (-not $title) {
      continue
    }

    $diagramRows += [ordered]@{
      row = $rowNumber
      title = $title
      subtitle = ((Get-RowValue -Row $diagramsSheet.Rows["$($rowNumber + 1)"] -Column 'A').Trim())
      sourceUrl = $diagramsSheet.Hyperlinks[$cellRef]
    }
  }

  $diagrams = @()
  for ($index = 0; $index -lt $diagramRows.Count; $index++) {
    $diagramRow = $diagramRows[$index]
    $mediaPath = if ($index -lt $imageAnchors.Count) { $imageAnchors[$index].mediaPath } else { $null }
    $imageFileName = $null
    $imageWebPath = $null

    if ($mediaPath) {
      $extension = [System.IO.Path]::GetExtension($mediaPath)
      $safeSlug = (($diagramRow.title.ToLowerInvariant() -replace '[^a-z0-9]+', '-') -replace '(^-|-$)', '')
      $imageFileName = ('{0:D3}-{1}{2}' -f ($index + 1), $safeSlug, $extension)
      $imageDestination = Join-Path $diagramsDir $imageFileName
      Export-ZipEntry -Zip $zip -EntryName $mediaPath -Destination $imageDestination | Out-Null
      $imageWebPath = ('assets/diagrams/' + $imageFileName)
    }

    $diagrams += [ordered]@{
      id = ('diagram-' + '{0:D3}' -f ($index + 1))
      title = $diagramRow.title
      subtitle = $diagramRow.subtitle
      sourceUrl = $diagramRow.sourceUrl
      imagePath = $imageWebPath
      hotspots = @()
    }
  }

  $catalogData = [ordered]@{
    importedAt = (Get-Date).ToString('s')
    workbookPath = $WorkbookPath
    sources = $sources
    parts = $parts
    diagrams = $diagrams
  }

  $json = $catalogData | ConvertTo-Json -Depth 10
  $jsonPath = Join-Path $dataDir 'catalog-data.json'

  Set-Content -LiteralPath $jsonPath -Value $json -Encoding UTF8
  & node (Join-Path $root 'scripts\write-catalog-bundles.js') $jsonPath | Out-Null

  Write-Output ("Imported {0} parts and {1} diagrams." -f $parts.Count, $diagrams.Count)
  Write-Output ("Wrote data files to {0}" -f $dataDir)
  Write-Output ("Extracted diagram images to {0}" -f $diagramsDir)
}
finally {
  if ($zip) { $zip.Dispose() }
  $memoryStream.Dispose()
  $fileStream.Dispose()
}
