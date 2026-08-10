export type ParserWarningCode =
  | 'unsupported_element'
  | 'unsupported_transform'
  | 'malformed_path'
  | 'invalid_dimensions'
  | 'invalid_arc'
  | 'empty_geometry'
  | 'malformed_svg'

export type ParserWarning = {
  code: ParserWarningCode
  message: string
  element?: string
}
