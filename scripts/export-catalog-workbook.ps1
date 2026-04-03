param(
  [string]$CatalogPath = '.\data\catalog-data.json',
  [string]$OutputPath = '.\data\catalog-database.xlsx'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-OptionalValue {
  param(
    $Object,
    [string]$Name
  )

  if ($null -eq $Object) {
    return $null
  }

  $prop = $Object.PSObject.Properties[$Name]
  if ($null -eq $prop) {
    return $null
  }

  return $prop.Value
}

function Escape-XmlText {
  param([string]$Value)

  if ($null -eq $Value) {
    return ''
  }

  return ([System.Security.SecurityElement]::Escape([string]$Value))
}

function Export-SpreadsheetXml {
  param(
    [Parameter(Mandatory = $true)] [array]$SheetSpecs,
    [Parameter(Mandatory = $true)] [string]$Path
  )

  $builder = [System.Text.StringBuilder]::new()
  [void]$builder.AppendLine('<?xml version="1.0"?>')
  [void]$builder.AppendLine('<?mso-application progid="Excel.Sheet"?>')
  [void]$builder.AppendLine('<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">')
  [void]$builder.AppendLine('  <Styles>')
  [void]$builder.AppendLine('    <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#EAF4F8" ss:Pattern="Solid"/></Style>')
  [void]$builder.AppendLine('  </Styles>')

  foreach ($spec in $SheetSpecs) {
    $sheetName = Escape-XmlText -Value $spec.Name
    [void]$builder.AppendLine("  <Worksheet ss:Name=""$sheetName"">")
    [void]$builder.AppendLine('    <Table>')

    $rows = @($spec.Rows)
    if ($rows.Count -eq 0) {
      [void]$builder.AppendLine('      <Row><Cell><Data ss:Type="String">No data</Data></Cell></Row>')
      [void]$builder.AppendLine('    </Table>')
      [void]$builder.AppendLine('  </Worksheet>')
      continue
    }

    $properties = @($rows[0].PSObject.Properties.Name)
    [void]$builder.AppendLine('      <Row>')
    foreach ($property in $properties) {
      $text = Escape-XmlText -Value $property
      [void]$builder.AppendLine("        <Cell ss:StyleID=""Header""><Data ss:Type=""String"">$text</Data></Cell>")
    }
    [void]$builder.AppendLine('      </Row>')

    foreach ($row in $rows) {
      [void]$builder.AppendLine('      <Row>')
      foreach ($property in $properties) {
        $value = $row.$property
        $text = Escape-XmlText -Value ([string]$value)
        [void]$builder.AppendLine("        <Cell><Data ss:Type=""String"">$text</Data></Cell>")
      }
      [void]$builder.AppendLine('      </Row>')
    }

    [void]$builder.AppendLine('    </Table>')
    [void]$builder.AppendLine('  </Worksheet>')
  }

  [void]$builder.AppendLine('</Workbook>')
  [System.IO.File]::WriteAllText($Path, $builder.ToString(), [System.Text.Encoding]::UTF8)
}

function Resolve-ProjectPath {
  param([string]$PathValue)
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return $PathValue
  }
  return (Join-Path -Path (Join-Path -Path $PSScriptRoot -ChildPath '..') -ChildPath $PathValue)
}

$catalogFullPath = [System.IO.Path]::GetFullPath((Resolve-ProjectPath -PathValue $CatalogPath))
$outputFullPath = [System.IO.Path]::GetFullPath((Resolve-ProjectPath -PathValue $OutputPath))
$outputDir = Split-Path -Path $outputFullPath -Parent
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

if (-not (Test-Path -LiteralPath $catalogFullPath)) {
  throw "Catalog file not found: $catalogFullPath"
}

$catalog = Get-Content -LiteralPath $catalogFullPath -Raw | ConvertFrom-Json

$partsRows = foreach ($part in $catalog.parts) {
  [PSCustomObject]@{
    PartNumber = $part.partNumber
    Description = $part.description
    AppliesDetails = $part.appliesDetails
    Period = $part.period
    RequiredQty = $part.requiredQty
    Notes = $part.notes
    SupplierUrl = $part.supplierUrl
    RelatedPartNumbers = (($part.relatedPartNumbers | Where-Object { $_ }) -join ', ')
    LinkCount = @($part.links).Count
  }
}

$diagramRows = foreach ($diagram in $catalog.diagrams) {
  [PSCustomObject]@{
    DiagramId = $diagram.id
    Title = $diagram.title
    Subtitle = Get-OptionalValue -Object $diagram -Name 'subtitle'
    ImagePath = Get-OptionalValue -Object $diagram -Name 'imagePath'
    ApiImageUrl = Get-OptionalValue -Object $diagram -Name 'apiImageUrl'
    SourceUrl = Get-OptionalValue -Object $diagram -Name 'sourceUrl'
    Source = Get-OptionalValue -Object $diagram -Name 'source'
    VariantId = Get-OptionalValue -Object $diagram -Name 'sourceVariantId'
    ViewFamilyId = Get-OptionalValue -Object $diagram -Name 'viewFamilyId'
    ViewFamilyTitle = Get-OptionalValue -Object $diagram -Name 'viewFamilyTitle'
    HotspotCount = @($diagram.hotspots).Count
  }
}

$hotspotRows = foreach ($diagram in $catalog.diagrams) {
  foreach ($hotspot in @($diagram.hotspots)) {
    [PSCustomObject]@{
      DiagramId = $diagram.id
      DiagramTitle = $diagram.title
      Callout = $hotspot.callout
      PartNumber = $hotspot.partNumber
      XPercent = $hotspot.x
      YPercent = $hotspot.y
      Source = $hotspot.source
    }
  }
}

$sheetSpecs = @(
  @{ Name = 'Parts'; Rows = $partsRows },
  @{ Name = 'Diagrams'; Rows = $diagramRows },
  @{ Name = 'Hotspots'; Rows = $hotspotRows }
)

$excel = $null
$workbook = $null

try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false

  $workbook = $excel.Workbooks.Add()

  while ($workbook.Worksheets.Count -lt 3) {
    [void]$workbook.Worksheets.Add()
  }

  for ($index = 0; $index -lt $sheetSpecs.Count; $index++) {
    $sheet = $workbook.Worksheets.Item($index + 1)
    $spec = $sheetSpecs[$index]
    $sheet.Name = $spec.Name

    $rows = @($spec.Rows)
    if ($rows.Count -eq 0) {
      $sheet.Cells.Item(1, 1).Value2 = 'No data'
      continue
    }

    $properties = @($rows[0].PSObject.Properties.Name)
    for ($column = 0; $column -lt $properties.Count; $column++) {
      $sheet.Cells.Item(1, $column + 1).Value2 = $properties[$column]
      $sheet.Cells.Item(1, $column + 1).Font.Bold = $true
    }

    for ($rowIndex = 0; $rowIndex -lt $rows.Count; $rowIndex++) {
      $row = $rows[$rowIndex]
      for ($column = 0; $column -lt $properties.Count; $column++) {
        $value = $row.($properties[$column])
        $sheet.Cells.Item($rowIndex + 2, $column + 1).Value2 = if ($null -eq $value) { '' } else { [string]$value }
      }
    }

    $usedRange = $sheet.UsedRange
    $usedRange.EntireColumn.AutoFit() | Out-Null
    $sheet.Application.ActiveWindow.SplitRow = 1
    $sheet.Application.ActiveWindow.FreezePanes = $true
  }

  while ($workbook.Worksheets.Count -gt 3) {
    $workbook.Worksheets.Item($workbook.Worksheets.Count).Delete()
  }

  if (Test-Path -LiteralPath $outputFullPath) {
    Remove-Item -LiteralPath $outputFullPath -Force
  }

  $workbook.SaveAs($outputFullPath, 51)
  Write-Output "Workbook exported to $outputFullPath"
}
catch {
  $xmlPath = [System.IO.Path]::ChangeExtension($outputFullPath, '.xml')
  Export-SpreadsheetXml -SheetSpecs $sheetSpecs -Path $xmlPath
  Write-Warning "Excel automation failed, so the database was exported as Spreadsheet XML instead."
  Write-Output "Workbook exported to $xmlPath"
}
finally {
  if ($workbook) {
    try {
      $workbook.Close($false)
    }
    catch {
    }
    try {
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbook) | Out-Null
    }
    catch {
    }
  }
  if ($excel) {
    try {
      $excel.Quit()
    }
    catch {
    }
    try {
      [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
    }
    catch {
    }
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
